#!/usr/bin/env node
// Assemble the macOS download: a minimal `.app` around the built binary.
//
// The release ships no installer and `bundle.active` is false, so there is no
// Tauri bundler step to make this for us — this script is that step, and the
// workflow runs it on the macOS runner before zipping the result:
//
//   node src-tauri/macos/bundle.mjs --binary src-tauri/target/release/open-telestrator
//
// Why a bundle at all: macOS hangs camera, microphone and screen-recording
// permission on a bundle with the right `Info.plist` usage strings. A bare
// executable has nowhere to put them, so the system refuses the request with no
// dialog to approve — and those two inputs are the whole app. The strings live
// in `src-tauri/macos/Info.plist`; this script fills in the product name,
// identifier and version from `tauri.conf.json` so they cannot drift, checks
// they are all present, and writes the tree.
//
// Nothing here asks Apple for anything: no certificate, no notarisation, no
// developer account. The bundle is unsigned apart from the ad-hoc signature the
// workflow applies afterwards, which is a local bookkeeping signature and needs
// no identity. What that leaves is Gatekeeper: a downloaded copy is quarantined
// and has to be allowed once under Privacy & Security. See
// docs/tauri-desktop.md.

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where this script and the plist template live: `src-tauri/macos`. */
const MACOS_DIR = dirname(fileURLToPath(import.meta.url))
const TAURI_DIR = dirname(MACOS_DIR)
const ROOT = dirname(TAURI_DIR)

const CONFIG_PATH = join(TAURI_DIR, 'tauri.conf.json')
const TEMPLATE_PATH = join(MACOS_DIR, 'Info.plist')
const ICON_PATH = join(TAURI_DIR, 'icons', 'icon.icns')

/** What the binary is called inside the bundle; matches `CFBundleExecutable`. */
const EXECUTABLE = 'open-telestrator'

/**
 * The keys macOS will not ask on behalf of an app that lacks. The first two are
 * required before the camera and microphone prompts can appear at all; the third
 * is what the Screen Recording prompt reads, and the system refuses the request
 * without it.
 */
const REQUIRED_KEYS = [
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSScreenCaptureUsageDescription',
]

/** Mach-O magics, including the fat header, least-significant byte first. */
const MACHO_MAGICS = new Set(['cffaedfe', 'feedfacf', 'cafebabe', 'bebafeca'])

/** CPU types in the 64-bit Mach-O header, by `cputype` field. */
const ARCHES = new Map([
  [0x0100000c, 'arm64'],
  [0x01000007, 'x86_64'],
])

function fail(message) {
  process.stderr.write(`bundle.mjs: ${message}\n`)
  process.exit(1)
}

function usage() {
  return [
    'Usage: node src-tauri/macos/bundle.mjs --binary <path> [--out <path>]',
    '',
    '  --binary   the executable to put in Contents/MacOS (required)',
    '  --out      the .app to write; defaults to "<productName>.app"',
  ].join('\n')
}

function parseArgs(argv) {
  const args = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split('=', 2)
    if (flag === '--help' || flag === '-h') {
      process.stdout.write(`${usage()}\n`)
      process.exit(0)
    }
    if (!flag.startsWith('--')) fail(`unexpected argument "${argv[index]}"\n\n${usage()}`)
    const value = inline ?? argv[index + 1]
    if (value === undefined || value.startsWith('--')) fail(`${flag} needs a value\n\n${usage()}`)
    args.set(flag, value)
    if (inline === undefined) index += 1
  }
  return args
}

/** XML-escape a config value before it goes anywhere near the plist. */
function xml(value) {
  const escapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
  return value.replace(/[&<>]/g, (char) => escapes[char])
}

/**
 * The plist with the config's values in it.
 *
 * Everything here is a refusal, deliberately: a missing usage string is the one
 * mistake that would ship a bundle that cannot ask for its own two inputs, and
 * it is invisible until somebody on a Mac tries to use the app.
 */
function renderPlist(config) {
  const replacements = new Map([
    ['__PRODUCT_NAME__', xml(config.productName)],
    ['__IDENTIFIER__', xml(config.identifier)],
    ['__VERSION__', xml(config.version)],
  ])
  let plist = readFileSync(TEMPLATE_PATH, 'utf8')
  if (!plist.startsWith('<?xml')) fail(`${relative(ROOT, TEMPLATE_PATH)} is not an XML plist`)
  for (const [token, value] of replacements) plist = plist.replaceAll(token, value)
  const leftover = plist.match(/__[A-Z_]+__/)
  if (leftover) fail(`unfilled placeholder ${leftover[0]} in ${relative(ROOT, TEMPLATE_PATH)}`)
  // The one thing XML comments cannot contain, and the one thing that is easy to
  // write in a plist that documents a command line.
  for (const comment of plist.matchAll(/<!--([\s\S]*?)-->/g)) {
    if (comment[1].includes('--')) fail('a comment in Info.plist contains "--", which XML forbids')
  }
  for (const key of REQUIRED_KEYS) {
    const found = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`))
    if (!found) fail(`${key} is missing from ${relative(ROOT, TEMPLATE_PATH)}, or has no text`)
    if (found[1].trim().length < 20) fail(`${key} says too little for macOS to show it`)
  }
  if (!plist.trimEnd().endsWith('</plist>')) fail(`${relative(ROOT, TEMPLATE_PATH)} is truncated`)
  return plist
}

/** Refuse anything that is not a Mach-O, and say which CPU it is for. */
function describeBinary(path) {
  const header = Buffer.alloc(8)
  const handle = readFileSync(path)
  handle.copy(header, 0, 0, 8)
  const magic = header.subarray(0, 4).toString('hex')
  if (!MACHO_MAGICS.has(magic)) {
    fail(`${relative(ROOT, path)} is not a Mach-O executable (magic ${magic}) — is it a macOS build?`)
  }
  if (magic === 'cafebabe' || magic === 'bebafeca') return 'universal'
  return ARCHES.get(header.readUInt32LE(4)) ?? `unknown cputype 0x${header.readUInt32LE(4).toString(16)}`
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const binaryArg = args.get('--binary')
  if (!binaryArg) fail(`--binary is required\n\n${usage()}`)
  const binary = resolve(ROOT, binaryArg)
  if (!existsSync(binary)) fail(`${relative(ROOT, binary)} does not exist; build it first`)
  if (!existsSync(ICON_PATH)) fail(`${relative(ROOT, ICON_PATH)} does not exist`)

  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  for (const field of ['productName', 'version', 'identifier']) {
    if (!config[field]) fail(`${relative(ROOT, CONFIG_PATH)} has no ${field}`)
  }

  const arch = describeBinary(binary)
  const plist = renderPlist(config)

  const app = resolve(ROOT, args.get('--out') ?? `${config.productName}.app`)
  const contents = join(app, 'Contents')
  rmSync(app, { recursive: true, force: true })
  mkdirSync(join(contents, 'MacOS'), { recursive: true })
  mkdirSync(join(contents, 'Resources'), { recursive: true })

  const executable = join(contents, 'MacOS', EXECUTABLE)
  copyFileSync(binary, executable)
  // `ditto` keeps the mode when the bundle is zipped, but a bundle assembled by
  // hand has to have the bit set in the first place.
  chmodSync(executable, 0o755)
  copyFileSync(ICON_PATH, join(contents, 'Resources', 'icon.icns'))
  writeFileSync(join(contents, 'Info.plist'), plist)

  const kilobytes = (path) => `${Math.round(statSync(path).size / 1024)} KB`
  process.stdout.write(
    [
      `${relative(ROOT, app)} — ${config.productName} ${config.version} (${config.identifier})`,
      `  Contents/MacOS/${EXECUTABLE}  ${arch}  ${kilobytes(executable)}`,
      `  Contents/Info.plist  usage strings: ${REQUIRED_KEYS.length}`,
      `  Contents/Resources/icon.icns  ${kilobytes(join(contents, 'Resources', 'icon.icns'))}`,
    ].join('\n') + '\n',
  )
}

main()

import { type Dispatch, type SetStateAction } from 'react'
import { ALL_TOOLS, COLORS } from '../lib/telestration'
import { INPUT_KINDS, type SupportedInput } from '../lib/cameraDevices'
import type { Tool } from '../lib/telestration'

/**
 * A compact, keyboard-driven tool palette that lives alongside the video in the
 * sidebar.
 *
 * The host can switch tool, colour and width without reaching for the mouse:
 * the shortcuts are listed in the legend on the right of the palette.
 */
export function DrawingSidebar({
  tool,
  setTool,
  color,
  setColor,
  width,
  setWidth,
  canUndo,
  onUndo,
  onClear,
  inputKind,
  setInputKind,
  deviceLabels,
}: {
  tool: Tool
  setTool: Dispatch<SetStateAction<Tool>>
  color: string
  setColor: Dispatch<SetStateAction<string>>
  width: number
  setWidth: Dispatch<SetStateAction<number>>
  canUndo: boolean
  onUndo: () => void
  onClear: () => void
  inputKind: SupportedInput
  setInputKind: Dispatch<SetStateAction<SupportedInput>>
  deviceLabels: Map<SupportedInput, string>
}) {
  /** Single device-select button, pulled out of JSX so `?.`/`??` parse cleanly. */
  function deviceButton(kind: SupportedInput): JSX.Element {
    const item = INPUT_KINDS.find((i) => i.kind === kind)
    const isOn = inputKind === kind
    return (
      <button
        key={kind}
        type="button"
        aria-label={`Use ${item?.label ?? kind}`}
        aria-pressed={isOn}
        data-testid={`sidebar-device-${kind}`}
        className={`swatch ${isOn ? 'swatch--on' : ''}`}
        style={{ background: item?.glyph ?? 'var(--panel-3)' }}
        onClick={() => setInputKind(kind)}
      >
        {item?.glyph ?? '⌘'}
      </button>
    )
  }

  return (
    <aside className="sidebar" data-testid="drawing-sidebar" aria-label="Drawing controls">
      <header className="sidebar__header">
        <h2>Draw</h2>
        <p className="sidebar__hint">Tools, colour, width, undo, clear.</p>
      </header>

      {/* Tool */}
      <section className="panel">
        <h3 className="panel__title">Tool</h3>
        <div className="swatch-row">
          {ALL_TOOLS.map((item) => (
            <button
              key={item}
              type="button"
              aria-label={`Select ${item} tool`}
              aria-pressed={tool === item}
              data-testid={`sidebar-tool-${item}`}
              className={`swatch swatch--icon ${tool === item ? 'swatch--on' : ''}`}
              onClick={() => setTool(item)}
            >
              {toolGlyph(item)}
            </button>
          ))}
        </div>
        <p className="panel__hint">
          <kbd className="kbd">1</kbd> Pen · <kbd className="kbd">2</kbd> Highlight
          · <kbd className="kbd">3</kbd> Rectangle · <kbd className="kbd">4</kbd> Circle
        </p>
      </section>

      {/* Colour */}
      <section className="panel">
        <h3 className="panel__title">Colour</h3>
        <div className="swatch-row">
          {COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Select colour ${swatch}`}
              aria-pressed={color === swatch}
              data-testid={`sidebar-colour-${swatch}`}
              className={`swatch ${color === swatch ? 'swatch--on' : ''}`}
              style={{ background: swatch }}
              onClick={() => setColor(swatch)}
            />
          ))}
        </div>
        <p className="panel__hint">
          <kbd className="kbd">C</kbd> Cycle colour forward · <kbd className="kbd">X</kbd> Cycle backward
        </p>
      </section>

      {/* Width */}
      <section className="panel">
        <h3 className="panel__title">Width</h3>
        <label className="range">
          <span className="range__label">{width} px</span>
          <input
            type="range"
            min={2}
            max={16}
            step={1}
            value={width}
            data-testid="sidebar-width"
            onChange={(event) => setWidth(Number(event.target.value))}
          />
          <span className="range__thumb" aria-hidden="true" />
        </label>
        <p className="panel__hint">
          <kbd className="kbd">W</kbd> Decrease width · <kbd className="kbd">E</kbd> Increase width
        </p>
      </section>

      {/* Input & device */}
      <section className="panel">
        <h3 className="panel__title">Device</h3>
        <div className="swatch-row">
          {(Object.keys(INPUT_KINDS) as SupportedInput[]).map((kind) =>
            deviceButton(kind)
          )}
        </div>
        <p className="panel__hint">
          {Array.from(deviceLabels.entries()).map(([k, label]) => (
            <span key={k}>
              {inputKind === k ? <strong>{label}</strong> : <label>{label}</label>}
            </span>
          ))}
        </p>
      </section>

      {/* Actions */}
      <section className="panel">
        <h3 className="panel__title">Actions</h3>
        <div className="action-row">
          <button
            type="button"
            className="btn btn--ghost"
            data-testid="sidebar-undo"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo last stroke"
          >
            ↺
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            data-testid="sidebar-clear"
            onClick={onClear}
            disabled={!canUndo}
            title="Clear all strokes"
          >
            🗑
          </button>
        </div>
        <p className="panel__hint">
          <kbd className="kbd">Z</kbd> Undo · <kbd className="kbd">Shift+Z</kbd> Redo
          · <kbd className="kbd">Del</kbd> Clear
        </p>
      </section>
    </aside>
  )
}

/**
 * Tiny, deterministic glyph helper that keeps the tool icons inline with the
 * renderer and avoids relying on emoji fallbacks in the sidebar buttons.
 */
function toolGlyph(tool: Tool): string {
  switch (tool) {
    case 'pen':
      return '✎'
    case 'highlight':
      return '⎘'
    case 'rect':
      return '▭'
    case 'ellipse':
      return '◯'
  }
}

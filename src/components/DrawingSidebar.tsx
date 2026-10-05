import { type Dispatch, type SetStateAction } from 'react'
import { ALL_TOOLS, COLORS, toolGlyph, type DrawMode, type Tool } from '../lib/telestration'

/**
 * A compact, keyboard-driven tool palette that lives alongside the video in the
 * sidebar.
 *
 * The host can switch mode, tool, colour and width without reaching for the
 * mouse: the shortcuts are listed in the legend under each section.
 */
export function DrawingSidebar({
  mode,
  setMode,
  tool,
  setTool,
  color,
  setColor,
  width,
  setWidth,
  canUndo,
  onUndo,
  onClear,
}: {
  mode: DrawMode
  setMode: Dispatch<SetStateAction<DrawMode>>
  tool: Tool
  setTool: Dispatch<SetStateAction<Tool>>
  color: string
  setColor: Dispatch<SetStateAction<string>>
  width: number
  setWidth: Dispatch<SetStateAction<number>>
  canUndo: boolean
  onUndo: () => void
  onClear: () => void
}) {
  return (
    <aside className="sidebar" data-testid="drawing-sidebar" aria-label="Drawing controls">
      <header className="sidebar__header">
        <h2>Draw</h2>
        <p className="sidebar__hint">Mode, tools, colour, width, undo, clear.</p>
      </header>

      {/* Draw vs Control: whether the pointer draws or reaches the video. */}
      <section className="panel">
        <h3 className="panel__title">Mode</h3>
        <div className="action-row">
          <button
            type="button"
            className={`chip ${mode === 'draw' ? 'chip--on' : ''}`}
            aria-pressed={mode === 'draw'}
            data-testid="mode-draw"
            onClick={() => setMode('draw')}
            title="Drawing: the pointer draws on the canvas"
          >
            ✏️ Draw
          </button>
          <button
            type="button"
            className={`chip ${mode === 'control' ? 'chip--on' : ''}`}
            aria-pressed={mode === 'control'}
            data-testid="mode-control"
            onClick={() => setMode('control')}
            title="Video controls: clicks pass through to the video underneath"
          >
            🖱️ Control
          </button>
        </div>
        <p className="panel__hint">
          Control lets clicks reach the shared video; Draw keeps annotating.
        </p>
      </section>

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

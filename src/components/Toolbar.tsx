import type { Tool } from '../lib/telestration'

export const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ffffff'] as const

const TOOLS: { id: Tool; label: string; glyph: string }[] = [
  { id: 'pen', label: 'Pen', glyph: '✎' },
  { id: 'line', label: 'Line', glyph: '╱' },
  { id: 'arrow', label: 'Arrow', glyph: '↗' },
  { id: 'ellipse', label: 'Circle', glyph: '◯' },
]

export type Mode = 'draw' | 'control'

interface ToolbarProps {
  mode: Mode
  onModeChange: (mode: Mode) => void
  tool: Tool
  onToolChange: (tool: Tool) => void
  color: string
  onColorChange: (color: string) => void
  width: number
  onWidthChange: (width: number) => void
  canUndo: boolean
  onUndo: () => void
  onClear: () => void
}

export function Toolbar({
  mode,
  onModeChange,
  tool,
  onToolChange,
  color,
  onColorChange,
  width,
  onWidthChange,
  canUndo,
  onUndo,
  onClear,
}: ToolbarProps) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Telestration tools">
      <div className="toolbar__group" role="group" aria-label="Input mode">
        <button
          type="button"
          className={`chip ${mode === 'draw' ? 'chip--on' : ''}`}
          aria-pressed={mode === 'draw'}
          data-testid="mode-draw"
          onClick={() => onModeChange('draw')}
          title="Drawing: pointer draws on the canvas"
        >
          ✏️ Draw
        </button>
        <button
          type="button"
          className={`chip ${mode === 'control' ? 'chip--on' : ''}`}
          aria-pressed={mode === 'control'}
          data-testid="mode-control"
          onClick={() => onModeChange('control')}
          title="Video controls: clicks pass through to the video underneath"
        >
          🖱️ Control
        </button>
      </div>

      <div className="toolbar__group" role="group" aria-label="Drawing tool">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`chip chip--icon ${tool === item.id ? 'chip--on' : ''}`}
            aria-pressed={tool === item.id}
            data-testid={`tool-${item.id}`}
            disabled={mode !== 'draw'}
            onClick={() => onToolChange(item.id)}
            title={item.label}
          >
            {item.glyph}
          </button>
        ))}
      </div>

      <div className="toolbar__group" role="group" aria-label="Colour">
        {COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={`swatch ${color === swatch ? 'swatch--on' : ''}`}
            style={{ background: swatch }}
            aria-label={`Colour ${swatch}`}
            aria-pressed={color === swatch}
            disabled={mode !== 'draw'}
            onClick={() => onColorChange(swatch)}
          />
        ))}
      </div>

      <label className="toolbar__group toolbar__width">
        <span>Width</span>
        <input
          type="range"
          min={2}
          max={16}
          step={1}
          value={width}
          disabled={mode !== 'draw'}
          onChange={(event) => onWidthChange(Number(event.target.value))}
        />
      </label>

      <div className="toolbar__group">
        <button
          type="button"
          className="chip"
          data-testid="undo"
          onClick={onUndo}
          disabled={!canUndo}
        >
          ↺ Undo
        </button>
        <button
          type="button"
          className="chip"
          data-testid="clear"
          onClick={onClear}
          disabled={!canUndo}
        >
          🗑 Clear
        </button>
      </div>
    </div>
  )
}

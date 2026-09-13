export interface DragPoint {
  x: number;
  y: number;
}

interface DragGesture {
  startWindow?: DragPoint;
  startMouse?: DragPoint;
  lastMoved?: DragPoint;
  tickerStop?: () => void;
}

export type WindowPositionReader = () => Promise<DragPoint>;
export type MousePositionReader = () => Promise<DragPoint>;
export type WindowMover = (x: number, y: number) => Promise<void>;
export type DragTicker = (onTick: () => void) => () => void;

export function shouldBeginWindowDrag(button: number, inHeader: boolean, inInteractiveControl: boolean): boolean {
  return button === 0 && inHeader && !inInteractiveControl;
}

export function windowPositionFromDrag(startWindow: DragPoint, startMouse: DragPoint, currentMouse: DragPoint): DragPoint {
  return {
    x: Math.round(startWindow.x + currentMouse.x - startMouse.x),
    y: Math.round(startWindow.y + currentMouse.y - startMouse.y),
  };
}

function defaultTicker(onTick: () => void): () => void {
  const timer = window.setInterval(onTick, 16);
  return () => window.clearInterval(timer);
}

/**
 * Moves the borderless window by following the native cursor.
 *
 * Neutralino's beginDrag does not exist in the bundled 5.6.0 runtime and -webkit-app-region is not
 * honoured by WebView2, so the pointer drives the window directly. Both the cursor position and the
 * window position come from the same Win32 physical coordinate system, which keeps the window under
 * the cursor at every display scale without guessing a DPI factor. Pointer events only start and end
 * the gesture; a ticker polls the cursor so a missed pointermove cannot freeze the window.
 */
export class ManualWindowDrag {
  private gesture: DragGesture | undefined;
  private moveInFlight = false;

  constructor(
    private readonly readWindowPosition: WindowPositionReader,
    private readonly readMousePosition: MousePositionReader,
    private readonly moveWindow: WindowMover,
    private readonly reportError: (error: unknown) => void,
    private readonly ticker: DragTicker = defaultTicker,
  ) {}

  get dragging(): boolean {
    return this.gesture !== undefined;
  }

  async start(): Promise<void> {
    if (this.gesture) return;
    const gesture: DragGesture = {};
    this.gesture = gesture;
    try {
      const [startWindow, startMouse] = await Promise.all([this.readWindowPosition(), this.readMousePosition()]);
      if (this.gesture !== gesture) return;
      gesture.startWindow = startWindow;
      gesture.startMouse = startMouse;
      gesture.tickerStop = this.ticker(() => void this.tick(gesture));
    } catch (error) {
      if (this.gesture !== gesture) return;
      this.end();
      this.reportError(error);
    }
  }

  end(): void {
    const gesture = this.gesture;
    this.gesture = undefined;
    gesture?.tickerStop?.();
  }

  private async tick(gesture: DragGesture): Promise<void> {
    if (this.gesture !== gesture || !gesture.startWindow || !gesture.startMouse || this.moveInFlight) return;
    this.moveInFlight = true;
    try {
      const mouse = await this.readMousePosition();
      if (this.gesture !== gesture) return;
      const startWindow = gesture.startWindow;
      const startMouse = gesture.startMouse;
      const next = windowPositionFromDrag(startWindow, startMouse, mouse);
      // The ticker runs at a fixed rate, so an idle cursor must not spam the native window API.
      if (gesture.lastMoved && gesture.lastMoved.x === next.x && gesture.lastMoved.y === next.y) return;
      await this.moveWindow(next.x, next.y);
      if (this.gesture === gesture) gesture.lastMoved = next;
    } catch (error) {
      if (this.gesture !== gesture) return;
      this.end();
      this.reportError(error);
    } finally {
      this.moveInFlight = false;
    }
  }
}

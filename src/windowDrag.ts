export interface DragPoint {
  x: number;
  y: number;
}

interface DragGesture {
  generation: number;
  pointerId: number;
  startScreen: DragPoint;
  latestScreen: DragPoint;
  scale: number;
  startWindow?: DragPoint;
}

interface PendingMove {
  generation: number;
  position: DragPoint;
}

export type WindowPositionReader = () => Promise<DragPoint>;
export type WindowMover = (x: number, y: number) => Promise<void>;

export function shouldBeginWindowDrag(button: number, inHeader: boolean, inInteractiveControl: boolean): boolean {
  return button === 0 && inHeader && !inInteractiveControl;
}

// Pointer events report logical (DPI-independent) screen pixels, while Neutralino's getPosition and
// move use physical window pixels. On a scaled display the raw delta would move the window slower
// than the cursor, so the pointer delta is converted with the device pixel ratio.
export function windowPositionFromDrag(startWindow: DragPoint, startScreen: DragPoint, currentScreen: DragPoint, scale = 1): DragPoint {
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    x: startWindow.x + (currentScreen.x - startScreen.x) * factor,
    y: startWindow.y + (currentScreen.y - startScreen.y) * factor,
  };
}

/**
 * Moves a borderless window without relying on Neutralino beginDrag, which can resolve without
 * moving on some Windows/WebView runtime combinations. Move requests are coalesced so at most one
 * native request is in flight and only the latest pointer position is retained.
 */
export class ManualWindowDrag {
  private gesture: DragGesture | undefined;
  private generation = 0;
  private pendingMove: PendingMove | undefined;
  private moveInFlight = false;

  constructor(
    private readonly readPosition: WindowPositionReader,
    private readonly moveWindow: WindowMover,
    private readonly reportError: (error: unknown) => void,
    private readonly readScale: () => number = () => 1,
  ) {}

  async start(pointerId: number, screen: DragPoint): Promise<void> {
    const generation = ++this.generation;
    this.pendingMove = undefined;
    this.gesture = { generation, pointerId, startScreen: screen, latestScreen: screen, scale: this.readScale() };
    try {
      const startWindow = await this.readPosition();
      const gesture = this.gesture;
      if (!gesture || gesture.generation !== generation) return;
      gesture.startWindow = startWindow;
      this.queueCurrentPosition(gesture);
    } catch (error) {
      if (this.gesture?.generation !== generation) return;
      this.end(pointerId);
      this.reportError(error);
    }
  }

  update(pointerId: number, screen: DragPoint): void {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== pointerId) return;
    gesture.latestScreen = screen;
    if (gesture.startWindow) this.queueCurrentPosition(gesture);
  }

  end(pointerId?: number): void {
    if (pointerId !== undefined && this.gesture?.pointerId !== pointerId) return;
    this.generation++;
    this.gesture = undefined;
    this.pendingMove = undefined;
  }

  private queueCurrentPosition(gesture: DragGesture): void {
    if (!gesture.startWindow) return;
    this.pendingMove = {
      generation: gesture.generation,
      position: windowPositionFromDrag(gesture.startWindow, gesture.startScreen, gesture.latestScreen, gesture.scale),
    };
    void this.drainMoves();
  }

  private async drainMoves(): Promise<void> {
    if (this.moveInFlight) return;
    this.moveInFlight = true;
    try {
      while (this.pendingMove) {
        const move = this.pendingMove;
        this.pendingMove = undefined;
        try {
          await this.moveWindow(move.position.x, move.position.y);
        } catch (error) {
          if (this.gesture?.generation === move.generation) {
            this.end(this.gesture.pointerId);
            this.reportError(error);
          }
        }
      }
    } finally {
      this.moveInFlight = false;
      // A pointer update can arrive between the loop check and clearing the in-flight flag.
      if (this.pendingMove) void this.drainMoves();
    }
  }
}

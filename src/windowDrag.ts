export function shouldBeginWindowDrag(button: number, inHeader: boolean, inInteractiveControl: boolean): boolean {
  return button === 0 && inHeader && !inInteractiveControl;
}

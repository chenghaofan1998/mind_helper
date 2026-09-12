export async function attemptDesktopHide(
  hide: () => Promise<void>,
  onFailure: (error: unknown) => void,
): Promise<boolean> {
  try {
    await hide();
    return true;
  } catch (error) {
    onFailure(error);
    return false;
  }
}

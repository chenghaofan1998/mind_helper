export interface ClipboardEnvironment {
  nativeWrite?: (value: string) => Promise<unknown>;
  webWrite?: (value: string) => Promise<void>;
  legacyWrite?: (value: string) => boolean;
}

export async function copyText(value: string, environment: ClipboardEnvironment): Promise<void> {
  const errors: unknown[] = [];
  for (const write of [environment.nativeWrite, environment.webWrite]) {
    if (!write) continue;
    try {
      await write(value);
      return;
    } catch (error) {
      errors.push(error);
    }
  }
  if (environment.legacyWrite?.(value)) return;
  throw new Error(errors.length ? "无法访问剪贴板，请重试。" : "当前环境不支持剪贴板，请检查权限。");
}

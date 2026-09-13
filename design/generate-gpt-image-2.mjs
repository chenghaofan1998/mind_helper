import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("缺少 OPENAI_API_KEY。请在当前终端通过环境变量配置，不要把密钥写入仓库或命令参数。");
  process.exit(2);
}

const prompts = JSON.parse(await readFile(new URL("./gpt-image-2-prompts.json", import.meta.url), "utf8"));
const only = process.argv.find((value) => value.startsWith("--only="))?.slice(7);
const selected = only ? prompts.filter((item) => item.file === only) : prompts;
if (!selected.length) throw new Error(`未找到指定设计图：${only}`);

const outputDirectory = resolve(fileURLToPath(new URL("./generated/gpt-image-2/", import.meta.url)));
await mkdir(outputDirectory, { recursive: true });

for (const item of selected) {
  console.log(`正在生成：${item.title} → ${item.file}`);
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt: item.prompt,
      size: "1536x1024",
      quality: "high",
      output_format: "png",
      n: 1,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const code = payload?.error?.code ?? `HTTP_${response.status}`;
    const message = payload?.error?.message ?? "图像生成失败";
    throw new Error(`${item.file}: ${code}: ${message}`);
  }
  const encoded = payload?.data?.[0]?.b64_json;
  if (typeof encoded !== "string" || !encoded) throw new Error(`${item.file}: API 未返回图像数据`);
  await writeFile(resolve(outputDirectory, item.file), Buffer.from(encoded, "base64"));
  console.log(`已保存：design/generated/gpt-image-2/${item.file}`);
}

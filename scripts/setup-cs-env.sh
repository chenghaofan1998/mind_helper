#!/usr/bin/env bash
# Command Pocket · C# 本地虚拟编译环境安装（幂等）
# 部署到 ${CS_TOOLCHAIN:-$HOME/.cs-toolchain}，仅供 Linux 容器内验证，不入仓库。
set -euo pipefail

TCH="${CS_TOOLCHAIN:-$HOME/.cs-toolchain}"
SDK="8.0.424"
SDK_URL="https://builds.dotnet.microsoft.com/dotnet/Sdk/${SDK}/dotnet-sdk-${SDK}-linux-x64.tar.gz"
REF_URL="https://api.nuget.org/v3-flatcontainer/microsoft.netframework.referenceassemblies.net472/1.0.3/microsoft.netframework.referenceassemblies.net472.1.0.3.nupkg"
REF_VER="v4.7.2"
DOTNET="$TCH/dotnet/dotnet"

echo "== Command Pocket · C# 虚拟环境安装 → $TCH"

# 幂等：已装且可用 → 退出
if [ -x "$DOTNET" ] && [ -f "$TCH/refs/build/.NETFramework/$REF_VER/mscorlib.dll" ]; then
  echo "已存在，跳过。用 scripts/cs-check.sh 做编译+自测。"
  exit 0
fi

mkdir -p "$TCH"
echo "[1/3] 下载 .NET SDK ${SDK}（约 217MB）..."
node -e "
const https=require('https'),fs=require('fs');
const u=process.argv[1];
https.get(u,{timeout:600000},res=>{
  if(res.statusCode!==200){console.error('HTTP '+res.statusCode);process.exit(1);}
  const w=fs.createWriteStream(process.argv[2]); res.pipe(w);
  w.on('finish',()=>console.log('下载完成'));
}).on('error',e=>{console.error(e.message);process.exit(1);});
" "$SDK_URL" "$TCH/sdk.tar.gz"

echo "[2/3] 解包 SDK（经 /tmp 中转，规避挂载符号链接问题）..."
TMPD="$(mktemp -d)"
tar xzf "$TCH/sdk.tar.gz" -C "$TMPD"
cp -a "$TMPD/dotnet" "$TCH/dotnet"
rm -rf "$TMPD" "$TCH/sdk.tar.gz"

echo "[3/3] 下载 .NET Framework ${REF_VER} 引用程序集..."
node -e "
const https=require('https'),fs=require('fs');
const u=process.argv[1];
https.get(u,{timeout:300000},res=>{
  if(res.statusCode!==200){console.error('HTTP '+res.statusCode);process.exit(1);}
  const w=fs.createWriteStream(process.argv[2]); res.pipe(w);
  w.on('finish',()=>console.log('下载完成'));
}).on('error',e=>{console.error(e.message);process.exit(1);});
" "$REF_URL" "$TCH/refs.nupkg"

# unzip：优先系统，否则用随本脚本同环境已有的静态 unzip
UNZIP="$(command -v unzip || true)"
if [ -z "$UNZIP" ] && [ -x /tmp/cs/root/usr/bin/unzip ]; then
  UNZIP=/tmp/cs/root/usr/bin/unzip
fi
if [ -z "$UNZIP" ]; then
  echo "缺少 unzip，请先安装（apt-get install unzip）或用 CS_TOOLCHAIN 指向已有工具链。"
  exit 3
fi
mkdir -p "$TCH/refs"
"$UNZIP" -q -o "$TCH/refs.nupkg" "build/.NETFramework/$REF_VER/*" -d "$TCH/refs"
rm -f "$TCH/refs.nupkg"

export DOTNET_ROOT="$TCH/dotnet" DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
"$TCH/dotnet/dotnet" --version
ls "$TCH/refs/build/.NETFramework/$REF_VER/mscorlib.dll" >/dev/null
echo "== 安装完成。检查命令：scripts/cs-check.sh"

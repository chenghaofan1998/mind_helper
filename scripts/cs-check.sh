#!/usr/bin/env bash
# Command Pocket · C# 编译 + 自测（Linux 容器内虚拟环境）
# 前置：scripts/setup-cs-env.sh（幂等安装到 ${CS_TOOLCHAIN:-$HOME/.cs-toolchain}）
# 检查分两段：[1] Roslyn 编译全文件（net472 引用 · 语法/类型） [2] 剥离 UI 后 net8 真跑 SelfTest
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TCH="${CS_TOOLCHAIN:-$HOME/.cs-toolchain}"
DOTNET="$TCH/dotnet/dotnet"
SDK_DIR="$TCH/dotnet/sdk"
REF="$TCH/refs/build/.NETFramework/v4.7.2"
SRC="$ROOT/native/CommandPocketPilot.cs"

if [ ! -x "$DOTNET" ] || [ ! -f "$REF/mscorlib.dll" ]; then
  echo "缺少 C# 虚拟环境 → 先跑: bash scripts/setup-cs-env.sh"
  exit 2
fi
export DOTNET_ROOT="$TCH/dotnet" DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
SDK="$(ls "$SDK_DIR" | head -1)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "[1/2] Roslyn 编译全文件（net472 引用 · 语法/类型检查）"
"$DOTNET" "$SDK_DIR/$SDK/Roslyn/bincore/csc.dll" -nologo -noconfig -nostdlib -target:exe \
  -out:"$WORK/pilot.exe" \
  -r:"$REF/mscorlib.dll" -r:"$REF/System.dll" -r:"$REF/System.Core.dll" \
  -r:"$REF/System.Drawing.dll" -r:"$REF/System.Windows.Forms.dll" \
  "$SRC"

echo "[2/2] 剥离 UI → net8 真跑 SelfTest"
node "$ROOT/scripts/strip-logic.js" "$SRC" "$WORK/Program.cs" >/dev/null
cat > "$WORK/logic.csproj" <<'EOF'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <AssemblyName>pilotlogic</AssemblyName>
    <InvariantGlobalization>true</InvariantGlobalization>
  </PropertyGroup>
</Project>
EOF
"$DOTNET" run --project "$WORK/logic.csproj" -c Release 2>&1 | tail -3
exit "${PIPESTATUS[0]}"

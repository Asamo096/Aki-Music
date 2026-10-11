#!/usr/bin/env sh
#
# 校验「相对上游基线新增」的源码文件是否带 SPDX 许可证标识。
#
# 为什么不检查所有文件：本仓库绝大多数文件继承自上游 YesPlayMusic，
# 给它们逐个补头注释只会制造巨大的无意义 diff。因此只约束**新增**文件。
#
# 用法：sh scripts/check-spdx.sh
# 环境变量 BASE_TAG 可覆盖基线 tag（默认 upstream-0.4.11）
set -eu

BASE_TAG="${BASE_TAG:-upstream-0.4.11}"
SOURCE_REGEX='\.(js|ts|mjs|cjs|vue|scss|css)$'

if ! git rev-parse --verify --quiet "$BASE_TAG" >/dev/null; then
  echo "跳过 SPDX 检查：找不到基线 tag '$BASE_TAG'。"
  echo "CI 中请使用 actions/checkout 的 fetch-depth: 0 以获取完整历史与 tag。"
  exit 0
fi

added="$(git diff --name-only --diff-filter=A "$BASE_TAG"...HEAD | grep -E "$SOURCE_REGEX" || true)"

if [ -z "$added" ]; then
  echo "SPDX 检查通过：相对 $BASE_TAG 无新增源码文件。"
  exit 0
fi

failed=0
count=0
for file in $added; do
  [ -f "$file" ] || continue
  count=$((count + 1))
  if ! head -n 15 "$file" | grep -q "SPDX-License-Identifier"; then
    echo "缺少 SPDX 许可证标识: $file"
    failed=$((failed + 1))
  fi
done

if [ "$failed" -ne 0 ]; then
  echo ""
  echo "以上 $failed/$count 个新增文件缺少许可证标识。请在文件头部加入："
  echo ""
  echo "  // SPDX-License-Identifier: AGPL-3.0-or-later"
  echo ""
  echo "若该文件移植自上游（folia-major 等），还需保留原版权声明并注明修改，"
  echo "格式见 NOTICE.md §1.6。"
  exit 1
fi

echo "SPDX 检查通过：新增源码文件 $count 个，全部带有许可证标识。"

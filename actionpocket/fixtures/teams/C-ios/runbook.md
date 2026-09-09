# iOS 内测版发布手册（Team C）

> 目的：每周五给测试组出一个 TestFlight 内测包。
> 适用条件：feature 分支合入 develop 之后。
> 非目标：App Store 正式提审（走另外的 checklist）。

## 参数表

| 参数 | 说明 | 默认值 | 必填 |
|---|---|---|---|
| branch | 要出包的 git 分支 | develop | 是 |
| build_number | 递增构建号，比上一个大 1 | （自动读取） | 是 |
| signing_cert | 签名证书名 | Apple Distribution: Mobile Team (XXXX) | 是 |

## 前置条件

- [ ] Xcode 15+ 已安装
- [ ] 本机钥匙串里有上述 signing_cert
- [ ] App Store Connect 有对应 App 的权限

## 打包步骤

1. 切分支并确认干净

   ```bash
   git checkout {{branch}}
   git pull origin {{branch}}
   git status --porcelain
   ```

2. 读取当前构建号并 +1

   ```bash
   agvtool what-version
   agvtool next-version -all
   ```

3. 归档

   ```bash
   xcodebuild archive \
     -workspace ShopApp.xcworkspace \
     -scheme ShopApp \
     -configuration Release \
     -archivePath build/ShopApp-{{build_number}}.xcarchive \
     -allowProvisioningUpdates
   ```

4. 导出 ipa 并上传 TestFlight

   ```bash
   xcodebuild -exportArchive \
     -archivePath build/ShopApp-{{build_number}}.xcarchive \
     -exportOptionsPlist ExportOptions-testflight.plist \
     -exportPath build/export
   xcrun altool --upload-app -f build/export/ShopApp.ipa -t ios \
     --apiKey {{api_key}} --apiIssuer {{api_issuer}}
   ```

## 验证

- [ ] altool 返回 `No errors uploading`
- [ ] TestFlight 构建列表出现新构建号 `{{build_number}}`（约 10–20 分钟）
- [ ] 测试组收到邮件/推送

## 风险

- 证书过期是最常见失败点：报 `errSecInternalComponent` 时检查钥匙串与开发者后台。
- `{{api_key}}` 属于敏感凭据，禁止写进仓库与聊天工具。

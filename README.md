# ChatEase Contact Form for EmDash

WordPress版と同じ問い合わせ連携を提供する、EmDash用のネイティブプラグインです。
会社名・お名前・メールアドレス・任意の電話番号・お問い合わせ内容を、入力 → 確認 → 完了の3段階で受け付けます。

## 必要条件

- Node.js 22.23.4以上（開発時は `.node-version` とmiseを使用）
- EmDash 1.4.x / Astro 7.4.7以上の7.x
- ChatEaseワークスペースとAPIトークン
- EmDashの `EMDASH_ENCRYPTION_KEY` とメールプロバイダー
- 公開サイトのOriginと一致するEmDashのサイトURL設定
- 公開ルートと `email:send` / `network:request` の許可

EmDash 1.4.0が固定参照するZodには既知の脆弱性があるため、検証環境ではルートの `package.json` で `"overrides": { "zod": "^4.6.6" }` を設定しています。導入先でZodを直接参照している場合は、その依存指定も同じ範囲に揃えてください。依存パッケージ内の `overrides` は導入先に継承されません。導入先でも `npm audit` を確認してください。

Cloudflare WorkersとNode.jsの両方で使えるWeb標準APIを使用しています。
ChatEase API通信はWorkers対応の `redirect: 'manual'` を指定します。3xx応答は失敗として扱い、転送先を追従せずAPIトークンを転送しません。接続確認・ボード作成とも、認証ヘッダー、POST本文、20秒タイムアウトを維持します。
ローカルのworkerdで旧モードの例外と修正後の動作を検証します。本番へのデプロイはこの開発手順に含みません。

## インストール

このパッケージは未公開です。SDK/EMDASH_PLUGINで依存を導入し、配布物を作成します。

```sh
mise exec -- npm ci
mise exec -- npm run build
mise exec -- npm pack
```

作成した `bagooon-chatease-emdash-plugin-0.2.0.tgz` をEmDashサイトにインストールします。

```sh
npm install /path/to/bagooon-chatease-emdash-plugin-0.2.0.tgz
```

EmDashサイトの既存設定に登録を追加してください。

```js
import { defineConfig } from 'astro/config';
import emdash from 'emdash/astro';
import { chateasePlugin } from '@bagooon/chatease-emdash-plugin';

// 既存のdatabase、storage、adapterなどの設定と併用します。
export default defineConfig({
  integrations: [emdash({
    // ...既存の設定
    plugins: [chateasePlugin()],
  })],
});
```

設定ファイルには秘密情報を記述しません。EmDashの暗号化キーはサイト側の環境・シークレット管理機能で設定します。

## 設定とフォームの埋め込み

1. EmDash管理画面の「ChatEase 共通設定」でAPIトークン、ワークスペーススラッグ、返答期限、通知先メールアドレスを保存します。保存時にワークスペースの接続を確認します。
2. 必要に応じてTurnstileまたはreCAPTCHA v2のSite KeyとSecret Keyを設定します。両方のサービスが有効ならTurnstileを優先します。
3. 「ChatEase フォーム一覧」の「新規フォーム」からフォームを作成し、英小文字から始まるフォームID（例: `contact`）を設定します。
4. 投稿・固定ページの本文で「ChatEase お問い合わせフォーム」ブロックを挿入し、そのフォームIDを入力します。テーマが `emdash/ui` の `PortableText` を使用していれば描画コンポーネントは自動登録されます。

WordPressショートコードの代わりに、EmDashのPortable Text専用ブロックを使用します。
本文に保存されるのはフォームIDだけです。フォームの詳細設定や秘密情報を本文へ複製しません。
ネイティブプラグインとして `plugins` に登録します。管理画面のレジストリインストールや `sandboxed` 登録には対応していません。

Astroテンプレートへ直接設置することもできます。

```astro
---
import { ChatEaseForm } from '@bagooon/chatease-emdash-plugin/astro';
---
<ChatEaseForm formId="contact" />
```

入力画面のフォーム直前に、WordPress版と同じチャットでの返答・メール案内の説明文を表示します。連携先のワークスペース名が保存されている場合は、通知メールの件名も案内します。専用の連携設定があるフォームは専用ワークスペース名を使い、名前が未取得の場合は件名案内を省略します。既存サイトで名前が表示されない場合は、対象の共通設定またはフォーム専用設定を保存し直してください。

説明文は確認・完了画面には表示しません。同梱CSSを無効にしても説明文は表示し、`.chatease-intro` でサイト側の見た目を調整できます。

同一ページに複数のフォームを設置できます。公開フォームはJavaScriptが必要です。
静的生成されたページでも、フォーム設定の取得・確認・送信にはEmDashの実行環境が必要です。
独自のPortable Textレンダラーを使う場合は、公開されている `blockComponents` をそのレンダラーへ登録してください。

## フォームごとの設定

- フォーム名・公開/非公開、会社名・お名前・メール・本文のラベル
- 電話欄の表示と必須指定、同梱CSSの適用ON/OFF
- ボードタイトル（空欄時: 「フォームからのお問い合わせ」）
- 返答期限・通知先（空欄時は共通設定）
- 専用APIトークンとワークスペーススラッグ（両方空欄なら共通設定、片方のみは保存不可）
- ゲスト用あいことば（未設定なら付与しない。全角10文字相当以内）

「ChatEase フォーム一覧」を開くと、登録済みフォームの名前・ID・非公開状態と編集・削除ボタンを表示します。新規フォームボタンと一覧の間には余白を設け、フォーム間には区切り線を表示します。登録がない場合は未登録の案内を表示します。新規作成・編集はそれぞれのボタンから専用の管理URLで開き、保存後または「一覧に戻る」で一覧へ戻ります。入力エラー時は編集画面に入力内容を残します。

保存済みのフォームIDは変更できません。フォームの受付を一時的に止めるときは非公開にします。
不要になったフォームは一覧の「削除」から削除できます。確認ダイアログで対象の名前・IDを確認し、「削除する」を選択してください。フォーム設定と専用の連携情報を削除し、そのフォームIDを埋め込んだページではフォームを利用できなくなります。ChatEaseに作成済みのチャットボードや他のフォーム・共通設定は保持します。削除は取り消せません。別画面で設定が更新されている場合は削除を中止し、一覧を開き直してから再確認します。
秘密入力を空欄のまま保存した場合は既存値を維持します。解除する場合は対応する解除スイッチを使います。
フォーム専用トークンを解除して共通設定に戻す場合は、専用スラッグも空欄にしてください。

## 連携・運用

API連携、確認、スパム対策の正本は、ワークスペースの `docs/core/SERVICE_SPECIFICATION.md` の外部フォーム連携仕様を参照してください。

- 通信先は `https://chatease.jp` の既存HTTP APIです。秘密情報はサーバーだけで扱います。
- 通知はEmDash側のメールプロバイダーを使用します。メール設定を別途確認してください。
- 確認情報は15分で失効します。EmDashの定期タスクを実行するようホストを構成してください。15分ごとの掃除処理で期限切れの入力を削除します。
- ボード作成成功後の通知失敗は、WordPress版と同様に受付完了とし、フォームIDのみをサーバーログに記録します。通知の自動再送はありません。
- 処理中のプロセス停止などで外部APIへの送信結果が不明な場合は、同一キーで再送します。通知メールの厳密な一回配送は保証しません。
- CAPTCHA利用時は、CSPで選択したサービスのスクリプト・接続先・フレームを許可してください。同梱CSSを無効にした場合はサイト側で見た目を設定できます。

## 開発と検証

```sh
mise exec -- npm ci
mise exec -- npm run lint
mise exec -- npm run typecheck
mise exec -- npm test
mise exec -- npm run build
mise exec -- npm pack --dry-run
```

テストは外部APIとメールをモックし、本番への問い合わせやボード作成を行いません。`npm test` にはMiniflare/workerdで実行するWorkers回帰テストを含みます。外向きHTTP通信はすべてローカルモックへ閉じ込め、301・302・303・307・308で追従しないことと、接続確認失敗時に保存済み設定を変更しないことを検証します。

## 埋め込み方式の参照

- [EmDash: Portable Text rendering components](https://docs.emdashcms.com/plugins/creating-native-plugins/portable-text-components/)
- [EmDash: Your first native plugin](https://docs.emdashcms.com/plugins/creating-native-plugins/your-first-native-plugin/)

MIT License

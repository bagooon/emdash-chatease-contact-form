<a href="https://chatease.jp/"><img width="500" height="106" alt="ChatEase logo" src="./.github/assets/chatease_logo.svg" /></a>

# ChatEase Contact Form for EmDash

[![npm version](https://img.shields.io/npm/v/@bagooon/chatease-emdash-form.svg)](https://www.npmjs.com/package/@bagooon/chatease-emdash-form)
[![CI](https://github.com/bagooon/emdash-chatease-contact-form/actions/workflows/ci.yml/badge.svg)](https://github.com/bagooon/emdash-chatease-contact-form/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

ChatEase のチャットボードと連携できる、EmDash 用お問い合わせフォームプラグインです。

- 会社名 / お名前 / メールアドレス / 電話番号 / お問い合わせ内容のフォーム
- 入力 → 確認 → 完了の 3 ステップで受付
- ChatEase のチャットボードを自動生成し、管理者へメール通知
- フォームごとに連携先・ラベル・返答期限・通知先・スタイルを設定可能
- Cloudflare Turnstile / reCAPTCHA v2（チェックボックス）対応
- EmDash の本文ブロック、または Astro コンポーネントで設置可能

> ChatEase のワークスペース・API トークン・ワークスペーススラッグが必要です。

---

## 必要条件

- Node.js 22.23.4 以上（開発時は `.node-version` に従います）
- EmDash 1.4.x / Astro 7.4.7 以上の 7.x
- ChatEase のワークスペース・API トークン・ワークスペーススラッグ
- EmDash 側の暗号化キー（`EMDASH_ENCRYPTION_KEY`）とメールプロバイダーの設定
- EmDash の管理権限（`plugins:manage`）

Node.js / Cloudflare Workers の実行環境に対応しています。公開フォームには JavaScript が必要です。
ページを静的生成する場合も、フォームの読み込み・確認・送信を処理する EmDash のサーバーが必要です。

---

## インストール方法

### 1. 配布パッケージをインストール

EmDash サイトのディレクトリで次のコマンドを実行します。

```bash
npm install @bagooon/chatease-emdash-form
```

ローカル配布パッケージから導入する場合は、次のように `.tgz` ファイルを指定します。

```bash
npm install /path/to/bagooon-chatease-emdash-form-0.2.1.tgz
```

`/path/to/` は実際の配置先に置き換えてください。ソースから作成する場合は、末尾の「開発」を参照してください。

### 2. EmDash にプラグインを登録

サイトの `astro.config.mjs` または `astro.config.ts` にインポートを追加し、既存の `emdash()` の `plugins` 配列へ `chateasePlugin()` を追加します。

```js
import { defineConfig } from 'astro/config';
import emdash from 'emdash/astro';
import { chateasePlugin } from '@bagooon/chatease-emdash-form';

export default defineConfig({
  // 既存のサイト設定
  integrations: [
    // 既存の integrations
    emdash({
      // 既存の EmDash 設定（database、storage など）
      plugins: [
        // 既存のプラグイン
        chateasePlugin(),
      ],
    }),
  ],
});
```

上記は設定の構成例です。既存の設定ファイルへ必要な部分を追加してください。`database`・`storage`・`adapter`・他の integrations など、サイトの設定はそのまま使用してください。
ネイティブプラグインとして登録する方式です。管理画面のレジストリ導入や `sandboxed` 登録には対応していません。

サイト側の環境変数・シークレット管理機能で `EMDASH_ENCRYPTION_KEY` を設定し、メールプロバイダーを構成してください。
プラグインは `email:send` / `network:request` を使用します。API トークンなどの秘密情報は、以下の管理画面で設定します。

設定変更後はサイトの通常の手順で再ビルド・再起動し、管理画面に **ChatEase 共通設定** と **ChatEase フォーム一覧** が表示されることを確認してください。

---

## 初期設定

### 1. ChatEase 共通設定

EmDash 管理画面の **ChatEase 共通設定** を開き、次の項目を入力して **保存** を押します。

| 項目 | 設定内容 |
| --- | --- |
| ChatEase API トークン | 連携先の ChatEase API トークン |
| ワークスペーススラッグ | 連携先ワークスペースのスラッグ |
| 返答期限（日数） | 問い合わせを受け付けた日からの日数。初期値は 1 日、指定範囲は 1〜3650 日 |
| 通知先メールアドレス | 問い合わせ受付を通知する管理者のメールアドレス |
| タイムゾーン | 返答期限の日付計算に使用。初期値は `Asia/Tokyo` |
| Turnstile Site Key / Secret Key | Cloudflare Turnstile を使用する場合に両方入力 |
| reCAPTCHA v2 Site Key / Secret Key | reCAPTCHA v2（チェックボックス）を使用する場合に両方入力 |

保存時に ChatEase への接続を確認します。接続に失敗した場合は保存せず、既存の設定を保持します。
API トークン・スラッグを確認してから再度保存してください。

ここで設定した連携先・返答期限・通知先は、フォームの共通設定として使用します。

### 2. ChatEase フォームの作成

1. **ChatEase フォーム一覧** → **新規フォーム** を開きます。
2. **フォームID** に `contact` などの識別子、**フォーム名** に `お問い合わせ` などの管理用の名前を入力します。
3. **フォームを公開する** を有効にし、必要な項目を設定します。
4. **保存** を押します。保存後はフォーム一覧に戻ります。

フォームIDは英小文字から始め、英小文字・数字・ハイフンで 64 文字以内にします。
保存後は変更できません。後で本文ブロックに同じIDを指定するため、控えておいてください。

| 項目 | 設定内容 |
| --- | --- |
| 会社名・お名前・メールアドレス・お問い合わせ内容のラベル | 公開フォームの項目名 |
| 電話番号入力欄を表示 / 電話番号を必須にする | 電話欄の表示と必須入力を指定 |
| プラグイン同梱スタイルを適用 | 標準の見た目を使用するかを指定 |
| チャットボードタイトル | 空欄の場合は「フォームからのお問い合わせ」 |
| 返答期限 / 通知先メールアドレス | 空欄の場合は共通設定を使用 |
| フォーム専用ワークスペーススラッグ / フォーム専用APIトークン | 共通設定と異なるワークスペースへ連携する場合に両方指定 |
| ゲスト用あいことば | ボードへのアクセス時に必要なあいことば。未設定なら付与しません。全角 10 文字相当以内 |

**専用APIトークンとワークスペーススラッグの設定場所は、このフォームの作成・編集画面です。**
専用の連携情報を両方とも設定しない場合は、共通設定を使用します。片方だけの指定では保存できません。

API トークンやあいことばなどの秘密入力は、保存後に内容を再表示しません。空欄のまま保存すると既存値を維持します。
削除する場合は対応する **解除** スイッチを有効にして保存してください。
フォーム専用の連携先を共通設定へ戻す場合は、**フォーム専用APIトークンを解除** を有効にし、専用ワークスペーススラッグも空欄にして保存します。

---

## フォームの設置方法

### 投稿・固定ページに設置する

1. EmDash の投稿・固定ページの本文エディターを開きます。
2. **ChatEase お問い合わせフォーム** ブロックを追加します。
3. ブロックの **フォームID** に、作成済みフォームのID（例：`contact`）を入力します。
4. ページを保存・公開し、公開ページを確認します。

テーマが `emdash/ui` の `PortableText` を使用している場合、描画コンポーネントは自動登録されます。
独自の Portable Text レンダラーを使う場合は、パッケージの `/astro` から公開している `blockComponents` を登録してください。
本文に保存されるのはフォームIDだけで、API トークンなどの秘密情報は含まれません。
同一ページに複数のフォームを設置することもできます。

### Astro テンプレートに直接設置する

```astro
---
import { ChatEaseForm } from '@bagooon/chatease-emdash-form/astro';
---
<ChatEaseForm formId="contact" />
```

`contact` は、作成済みフォームのIDに置き換えてください。

### 公開フォームの動作

お名前・メールアドレス・お問い合わせ内容は必須、会社名は任意です。電話番号はフォーム設定に従います。
入力内容を確認画面で確かめ、送信すると受付完了になります。確認内容の有効期限は 15 分です。

入力画面ではフォームの前に、チャットで返答することと、アクセス方法をメールで案内することを説明します。
連携先のワークスペース名を取得済みの場合は、通知メールの件名も案内します。
説明文は確認・完了画面には表示しません。同梱スタイルを無効にしても表示され、`.chatease-intro` で見た目を調整できます。

---

## フォームの編集・非公開・削除

**ChatEase フォーム一覧** に、登録済みフォームの名前・ID・非公開状態と操作ボタンが表示されます。

- **編集**：設定を変更して保存します。**一覧に戻る** で一覧へ戻れます。
- **一時的に受付を止める**：編集画面で **フォームを公開する** を無効にして保存します。
- **削除**：一覧の **削除** を押し、確認画面で対象の名前・IDを確認して **削除する** を選びます。**キャンセル** では変更しません。

削除するとフォーム設定・専用APIトークン・あいことばが削除され、そのIDを設置したページではフォームを利用できなくなります。
共通設定・他のフォーム・ChatEase に作成済みのチャットボードは保持します。削除は取り消せません。
別画面で設定が変更されている場合は、一覧を開き直してから再確認してください。

---

## ChatEase との連携仕様

確認画面から送信すると、次の内容でチャットボードを作成し、EmDash のメールプロバイダーで管理者へ通知します。

| 連携内容 | 値 |
| --- | --- |
| 作成先 | フォーム専用、または共通設定のワークスペース |
| ゲスト名 | 会社名とお名前を空白で結合。会社名が空欄ならお名前のみ |
| ゲストのメールアドレス | フォームに入力されたメールアドレス |
| 電話番号 | 表示が有効で入力がある場合、メモに `TEL: ...` として保存 |
| 初期ステータス | `scheduled_for_response`（返答予定） |
| 返答期限 | 設定タイムゾーンでの受付日から、指定日数後の日付 |
| 初回投稿 | お問い合わせ内容 |

ChatEase API への通信はサーバー側で行います。リダイレクトには追従せず、転送先へAPIトークンを送りません。

---

## スパム対策について

**ChatEase 共通設定** で Cloudflare Turnstile または reCAPTCHA v2（チェックボックス）の Site Key / Secret Key を設定します。

- 各サービスは、Site Key と Secret Key の両方が揃うと有効になります。
- 両サービスが有効な場合は、Turnstile を優先します。
- 確認画面へ進む前にサーバーで検証し、失敗した場合は入力画面にエラーを表示します。

サイトで CSP を設定している場合は、使用するサービスのスクリプト・接続先・フレームを許可してください。

---

## 動作確認・困ったとき

導入後は、公開ページで **入力 → 確認 → 戻る → 再確認 → 送信 → 完了** を試し、ChatEase 側のボード作成と管理者への通知メールをそれぞれ確認してください。
実際に送信するとボードと通知メールが作成されます。

| 症状 | 確認すること |
| --- | --- |
| フォームが表示されない | ブロックと管理画面のフォームIDが一致しているか、フォームが公開されているか、連携先と通知先が設定されているかを確認します。JavaScript と EmDash の実行環境も必要です。 |
| 接続確認に失敗する | API トークン・ワークスペーススラッグと、サーバーから `https://chatease.jp` への接続を確認します。 |
| 確認・送信が拒否される | EmDash のサイトURLが公開サイトの Origin（スキーム・ホスト・ポート）と一致しているか確認します。内部通信用のURLではなく、公開URLを設定してください。 |
| 説明文に通知メールの件名が出ない | 対象の共通設定、またはフォーム専用設定を保存し直してワークスペース名を取得します。専用設定があるフォームでは専用ワークスペース名を使います。 |
| 受付完了なのに通知メールが届かない | 共通・フォームの通知先、EmDash のメールプロバイダーとサーバーログを確認します。ボード作成後に通知が失敗しても受付は完了します。ログには `ChatEase administrator notification failed` とフォームIDを記録し、自動再送はしません。 |
| 確認画面で時間が経って送信できない | 確認内容は 15 分で失効します。入力画面から確認し直してください。 |

期限切れの確認情報を削除するため、ホスト側で EmDash の定期タスクを実行する設定も必要です。プラグインは 15 分ごとの削除タスクを登録します。
通信中のプロセス停止などにより送信結果が不明な場合、ボード作成は同じ識別キーで再送します。外部APIとメールをまたぐ厳密な一回実行は保証しません。

---

## ライセンス

[MIT](LICENSE)

---

## 開発

このリポジトリで `.node-version` の Node.js を使用します。mise のある環境では次の手順で検証できます。

```bash
mise exec -- npm ci
mise exec -- npm run lint
mise exec -- npm run typecheck
mise exec -- npm test
mise exec -- npm run check:package
```

配布パッケージを作成する場合：

```bash
mise exec -- npm pack
```

`bagooon-chatease-emdash-form-0.2.1.tgz` が作成されます。`npm pack` 時にもビルドを実行します。

テストは外部API・メールをモックし、実際の問い合わせやメールを送信しません。
Miniflare/workerd で、接続確認・共通設定保存・ボード作成と Workers の互換性も確認します。
API 通信は `redirect: 'manual'` とし、301・302・303・307・308 に追従しないこと、接続失敗時に設定を変更しないことを検証します。通信タイムアウトは 20 秒です。

検証環境では EmDash 1.4.0 の Zod 依存に対し、ルートの `package.json` に `"overrides": { "zod": "^4.6.6" }` を設定しています。
この設定は導入先へ継承されないため、導入先のルートでも依存関係を確認してください。Zod を直接依存に持つ場合は、その指定範囲も揃えます。`npm audit` で導入先の状態を確認してください。

### npm 公開の準備と手順

パッケージ名は `@bagooon/chatease-emdash-form` です。公開先と公開範囲は `publishConfig` で npm 公式レジストリ・public に設定しています。
GitHub Actions は `.node-version` の Node.js で依存導入・lint・型チェック・テスト・ビルド・配布内容の検査を実行します。

- `npm run build`：古い `dist` を削除して JavaScript と型定義を生成します。
- `npm run check:package`：ビルド後、配布ファイル・エントリーポイント・バージョン・プラグインdescriptorを検査します。
- `npm pack`：`prepack` でビルドし、配布パッケージを作成します。
- `npm publish`：`prepublishOnly` で lint・型チェック・テスト・配布検査を実行し、成功後にビルド・公開します。

配布物には `dist`、Astro 用コンポーネントと関連ソース、README・ロゴ・LICENSE を含めます。導入先でプラグイン自体をビルドする必要はありません。Astro 用ソースは導入先のサイトビルドで処理します。

初回公開時は `@bagooon` スコープへの公開権限がある npm アカウントでログインし、公開内容を確認してから実行します。

```bash
# 公開せずに、公開前チェックと配布内容を確認
mise exec -- npm publish --dry-run

# 承認後に公開
mise exec -- npm publish --access public
```

npm アカウントの認証・2要素認証は npm の案内に従ってください。認証情報はリポジトリに保存しません。
GitHub Actions は検証のみを実行し、自動公開は行いません。
旧ローカル配布版 `@bagooon/chatease-emdash-plugin` を導入済みの場合は、旧パッケージをアンインストールして新パッケージを導入し、設定・テンプレートの import 名を変更してください。EmDash 内部のプラグインIDは `chatease-contact-form` のままなので、既存の共通設定・フォームIDを引き続き使用します。

参考：[npm の package.json 設定](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)、[npm のライフサイクルスクリプト](https://docs.npmjs.com/cli/v11/using-npm/scripts/)

# 検証記録

確認日: 2026-10-15（Asia/Tokyo）。初回のローカル検証記録です。その後、AWS実機検証も成功しました。[実機検証結果](aws-verification.md)を参照してください。

## 実施結果

| 検証 | 結果 |
|---|---|
| `npm test` | 5/5成功。最終実行約454ms。HTTP子プロセスの正常起動・SIGTERM転送、終了コード7の伝播、ENOENT、起動期限、不正アドレスを確認 |
| PHP構文・Node構文・bash構文 | 成功 |
| 既定Dockerビルド | Linux Arm64のlocalターゲット成功 |
| `scripts/build.sh` | 成功。ZIPにindex.jsが直下、FrankenPHPに0755の実行権限 |
| 実バイナリHTTP smoke | GET `/`・`/hello?test=1`・`/healthz` → 200、`/missing` → 404、POST → 405、HEAD → 空本文・200 |
| PHP診断 | PHP 8.5.11、SAPI `frankenphp`、ZTS true、request IDヘッダーの受け渡し成功 |
| CLI | 実バイナリの `php-server --help` で `--listen`・`--root`・`--access-log` を確認 |
| 静的リンク | `file`: ELF 64-bit aarch64 static-pie。コンテナ内 `ldd`: statically linked |
| 読み取り専用環境 | 非root、read-only root、cap-drop ALL、no-new-privileges、tmpfs /tmpで成功 |
| readiness計測 | 初回121ms、最終108ms。Nodeランチャー開始→PHP health応答。AWSコールドスタート値ではない |
| 終了 | Docker stopの1秒猶予内に親→子SIGTERM転送・終了コード0。初回記録では転送から子終了まで約36ms |
| 任意ソースビルド | bash構文と公式Buildx bake `--print` のターゲット・引数解決のみ確認。C/Goの再コンパイルは未実行 |
| CLI deploy | インストール済みAWS CLI 2.37.13のhelpと公式文書で引数を確認。後続の実機検証で認証・デプロイ・HTTP応答・削除まで成功 |
| コードレビュー | 独立レビューで重大な不備の指摘なし。レビュアーのテストはsandboxのlisten EPERMで実行不可。実装者の権限付きテストは上記のとおり成功 |

ローカルランナーはNode.js 24系。Docker内はNode 24のDebian bookwormイメージ。AWS実行環境と同一のOSではありません。

## バイナリ

```text
FrankenPHP v1.13.0 PHP 8.5.11 Caddy v2.11.7
SHA256: 94c0503ce6d98254548c79402fddd47206d4671a5fffbbb020e53ae15fd8ba43
サイズ: 168,140,016 bytes
公式builder index digest:
sha256:90fbfc9aa7ad15d912f5e7f3772787e6fe558c011041159cfc205b891a844680
```

ビルダー全体ではなく、生成された実行ファイルだけがデプロイZIPに含まれます。ZIPは約57MiB、展開後約161MiBです。既定バイナリには多数の拡張が含まれます。ソースビルドスクリプトは `opcache` のみを追加指定するため、同一のバイナリにはなりません。

PHP 8.5では `PHP_ZTS` がbooleanだったため、JSON生成は `(bool) PHP_ZTS` としています。この版のFrankenPHPで `php-cli -v` は未対応と表示されます。以下のように確認してください。

```bash
docker run --rm --platform linux/arm64 \
  --entrypoint /app/bin/frankenphp staticphp-lambda-web-poc:local version

docker run --rm --platform linux/arm64 \
  --entrypoint /app/bin/frankenphp staticphp-lambda-web-poc:local \
  php-cli -r 'echo PHP_VERSION, " ZTS=", (int) PHP_ZTS, PHP_EOL; print_r(get_loaded_extensions());'
```

## AWS実機確認の初回チェックリスト

以下は初回作成時の記録です。2026-10-15の実機結果は [AWS実機検証](aws-verification.md) を正としてください。

以下は実験後に記入するための記録欄です。未記入は成功を意味しません。

| 項目 | 記録 |
|---|---|
| 日時・リージョン・CLI版 | 未実施 |
| Web Function / revision ID | 未実施 |
| バイナリハッシュ・展開サイズ | 未実施 |
| 子のspawnが成功するか | 未実施 |
| 子の指定HTTPソケットへAWSが転送するか | 未実施 |
| HTTPS `/hello` のJSONとSAPI・ZTS | 未実施 |
| AWS request IDとログの相関 | 未実施 |
| 起動10秒制限とコールドスタート | 未実施 |
| 環境再利用・並列性・負荷・メモリ | 未実施 |
| 子の障害後の環境回復 | 未実施 |
| SIGTERMの送信対象と終了猶予 | 未実施 |

成功判定は `Active` 表示ではなく、HTTPS経由のPHP JSON応答とプロセスログを揃えて行います。

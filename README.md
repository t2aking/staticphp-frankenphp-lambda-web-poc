# StaticPHP + FrankenPHP on AWS Lambda Web Functions

PHPカンファレンスに向けた最小の実験プロジェクト。Node.js 24がStaticPHP製FrankenPHPを子プロセスで起動し、FrankenPHP自身がAWS指定のHTTPアドレスを待ち受けます。

```text
HTTPS client → Lambda Web Function (TLS終端)
                         ↓ HTTP / AWS_LAMBDA_HTTP_ENDPOINT
                   FrankenPHP → public/index.php
                         ↑ spawn / signal / exit監視
                    Node.js 24 (index.js)
```

**通常モード・Worker ModeともにAWS実機検証に成功しました。** 2026-10-15、東京リージョンのNode.js 24からFrankenPHPを起動し、通常モード6回・Worker Mode4回のHTTP検証が成功しました。Worker内の状態保持も確認しています。検証用AWSリソースはすべて削除済みです。

[通常モードのAWS検証](docs/aws-verification.md) / [Worker ModeのAWS検証](docs/worker-aws.md) / [モードの比較とローカル手順](docs/worker-mode.md)

この実験結果はAWSによるPHPの正式サポート保証とは区別してください。

## 確認した公式仕様（2026-10-15）

| 項目 | 仕様とこのPoCでの扱い |
|---|---|
| ランタイム | `nodejs24.x`。既定エントリはZIPルートの `index.js`。PHP handlerは登録しない |
| CPU | 開始時点の提供アーキテクチャはArm64。Dockerは必ず `linux/arm64` |
| 待ち受け | `AWS_LAMBDA_HTTP_ENDPOINT` は `host:port`。値をそのまま `--listen` に渡す。ローカルでも明示設定が必要 |
| HTTP/TLS | TLSはLambda側で終端する。アプリは平文HTTP。`--domain` や証明書を設定しない |
| 初期化 | 起動から10秒以内にlisten開始が必要。このPoCは9秒以内にPHPの `/healthz` 応答を確認できなければ終了する |
| 終了 | SIGTERM後の猶予は最大1秒。親から子へ転送し、700msで未終了ならSIGKILL |
| 容量 | 展開後パッケージ512MB、環境2GBメモリ・2vCPU、`/tmp` 512MB |
| 子プロセス | Nodeの `spawn()` は公式API。ただしWeb Functionsの文書では、子プロセスのHTTP listenerへのルーティング保証は確認できなかった。東京の実機では成功を確認済み |

参照: [AWSランタイム](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-runtimes.html)、[ライフサイクル](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.html)、[環境変数](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-env-vars.html)、[制限](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)、[AWS発表](https://aws.amazon.com/blogs/aws/announcing-aws-lambda-web-functions-for-fast-consistent-web-app-performance-anywhere/)、[Node 24 child_process](https://nodejs.org/docs/latest-v24.x/api/child_process.html)。

9秒はこのPoC独自の猶予付き期限です。ログの `elapsed_ms` はNodeのランチャー開始からの時間で、AWSのパッケージ取得やランタイム準備を含むコールドスタート全体の時間ではありません。また `/healthz` はローカル監視用であり、Lambdaに登録するreadiness APIではありません。AWSはlistenを検知するため、このPoCのreadyログより先にリクエストが届く可能性があります。

## 必要なもの

- Docker Desktop等とBuildx（Arm64実行。x86ホストではエミュレーションが必要）
- Node.js 24（依存npmパッケージなし）、ZIP生成用の `zip`
- デプロイ時のみ、対応版AWS CLI v2、AWS認証情報と利用可能なリージョン

## Worker Mode追加

`FRANKENPHP_MODE=normal|worker` で切り替えます。既定の通常モードと既存エンドポイントを維持し、比較用の `/state` を追加しました。[比較手順・ローカル結果・AWS検証案](docs/worker-mode.md)を参照してください。

**Worker追加後も、利用者の事前承認を受けてAWSを最小限検証し、一時リソースを削除済みです。** 今後のAWS作成・更新・削除も実行前確認が必要です。以下のAWSデプロイ・削除コマンドを自動実行するものではありません。

## Dockerビルドとローカル実行

このディレクトリを作業ディレクトリにします。

```bash
npm test
./scripts/build.sh

docker buildx build --platform linux/arm64 --target local --load \
  -t staticphp-lambda-web-poc:local .

docker run --rm --name staticphp-lambda-web-poc \
  --platform linux/arm64 --read-only --tmpfs /tmp:rw,nosuid,size=64m \
  --cap-drop ALL --security-opt no-new-privileges \
  -p 127.0.0.1:3000:3000 \
  -e AWS_LAMBDA_HTTP_ENDPOINT=0.0.0.0:3000 \
  staticphp-lambda-web-poc:local
```

別のターミナルで:

```bash
curl -i http://127.0.0.1:3000/hello
npm run smoke
# またはコンテナ内から検証
# docker exec staticphp-lambda-web-poc node scripts/smoke.js

docker stop --time 1 staticphp-lambda-web-poc
```

`/`・`/hello`・`/healthz`・`/state` はGET/HEADに対応します。JSONには `message: "Hello from PHP!"`、`sapi: "frankenphp"`、`zts: true`、PHPバージョン・PID・リクエストIDが含まれます。その他のパスは404、POST等は405です。公開する情報はPoC用で、本番向けの診断APIではありません。

出力:

```text
dist/package/
  index.js
  package.json
  lib/launcher.js
  public/index.php
  bin/frankenphp     # Linux Arm64, executable 0755
dist/lambda-web.zip  # index.jsがZIP直下
```

ホスト上で直接起動する場合はLinux Arm64が必要です。macOSやLinux x86上からこのバイナリを直接実行できません。Linux Arm64では以下も利用できます。

```bash
AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:3000 node dist/package/index.js
```

## StaticPHPビルドの内訳

既定のDockerfileは、公式 `dunglas/frankenphp:static-builder-musl-1.13.0` をダイジェスト固定で使用し、**その中に既にStaticPHPでコンパイルされている** `/go/src/app/dist/frankenphp-linux-aarch64` を取り出します。毎回C/Goをコンパイルする手順ではありません。通常のFrankenPHPランナーから動的バイナリをコピーする構成とも異なります。ビルダーイメージは大きく、初回は数GBの取得・展開が発生します。

```text
sha256:90fbfc9aa7ad15d912f5e7f3772787e6fe558c011041159cfc205b891a844680
```

ソースからの再ビルドが必要な場合:

```bash
./scripts/build-source.sh
# この生成物でローカルイメージも作る場合
# docker buildx build --platform linux/arm64 --target local --load \
#   --build-arg STATIC_BUILDER=staticphp-poc-source:local \
#   -t staticphp-lambda-web-poc:local .
```

この任意手順はFrankenPHP v1.13.0の公式 `static-builder-musl` ターゲットを使用し、PHP 8.5.11・`opcache` を指定します。生成物はmuslの完全静的バイナリで、動的なPHP拡張の追加には対応しません。PHPコードはバイナリに埋め込まず、ZIPに分離します。

CLIの世代差に注意してください。現在のStaticPHP v3ドキュメントは `spc build:php … --build-frankenphp --enable-zts` ですが、固定したFrankenPHP公式ビルドスクリプトは `spc build --enable-zts --build-embed --build-frankenphp …` を使用します。このプロジェクトは公式スクリプトに合わせ、v3のコマンドを混在させません。

ソース再ビルド経路では上流スクリプトがStaticPHPのnightlyや依存ソースを取得します。FrankenPHP/PHP指定を固定しても、全依存を含むビット単位の再現性はありません。既定のダイジェスト固定済みバイナリ経路とは区別してください。GitHub API制限に達した場合、公式ターゲットが対応するBuildKit secret `github-token` を使えます。トークンをDocker ARGへ渡さないでください。

参照: [FrankenPHP静的ビルド](https://frankenphp.dev/docs/static/)、[固定版Dockerfile](https://github.com/php/frankenphp/blob/v1.13.0/static-builder-musl.Dockerfile)、[固定版ビルドスクリプト](https://github.com/php/frankenphp/blob/v1.13.0/build-static.sh)、[StaticPHP SAPI](https://static-php.dev/en/guide/sapi-reference.html)。

## NodeランチャーとFrankenPHP CLI

実行するコマンドは次の形です（絶対パスは配置先から決定）。

```bash
bin/frankenphp php-server \
  --listen "$AWS_LAMBDA_HTTP_ENDPOINT" \
  --root /absolute/path/to/public \
  --access-log
```

`--listen` と `--root` は [公式CLI実装](https://github.com/php/frankenphp/blob/v1.13.0/caddy/php-server.go) で確認しました。`php -S` のオプションではありません。この固定バイナリでは `php-cli -v` はPHP 8.6未満で未対応と表示されるため、バージョン確認はPHPコードで行います。既定の通常モードは `--worker` を指定しません。`FRANKENPHP_MODE=worker` を指定すると `--worker /absolute/path/to/public/index.php,1` を追加し、Worker数を1に固定します。実際のビルド済みCLIも確認できます。

```bash
docker run --rm --platform linux/arm64 \
  --entrypoint /app/bin/frankenphp staticphp-lambda-web-poc:local php-server --help
```

NodeはHTTPリバースプロキシを持ちません。`spawn()` をシェルなしで実行し、子の標準出力・標準エラーを継承します。親プロセスは子を参照し続け、終了を監視します。意図しない正常終了も異常として扱い、勝手に再起動しません。`ready`・`spawn_error`・`startup_timeout`・`child_exit` が診断ログです。初期化失敗後の環境破棄・再作成の挙動は今回の実機検証に含みません。

| 環境変数 | 用途 |
|---|---|
| `AWS_LAMBDA_HTTP_ENDPOINT` | 必須。AWSではAWSが設定するため上書きしない。ローカルでは明示設定 |
| `FRANKENPHP_MODE` | `normal`（既定）または `worker`。Worker ModeはWorker数1固定 |
| `FRANKENPHP_BINARY` | ローカルで別の実行ファイルを試すときだけ指定。既定はプロジェクト内 `bin/frankenphp` |
| `STARTUP_TIMEOUT_MS` | 起動監視期限、既定9000、1〜9000。AWSの10秒制限を伸ばす設定ではない |

子に渡す `HOME`・`XDG_CONFIG_HOME`・`XDG_DATA_HOME` は `/tmp` 配下に設定します。アプリ本体への書き込みは不要です。

## AWS Lambda Web Functionsへのデプロイ

**検証用アカウントでIAM認証付きの一時デプロイを実施し、HTTP成功と削除まで確認済みです。** [AWS検証結果](docs/aws-verification.md)を参照してください。 以下のコマンドはAWSリソースを作成し、利用料金が発生します。これは通常のLambda Event FunctionやFunction URLの手順ではありません。Dockerはローカルビルド用で、デプロイ対象はZIP/ディレクトリです。

1. CLIがWeb Functionsに対応していることを確認します。AWS CLI v2でも古い版は対応しません。

```bash
aws --version
aws lambda-web deploy help
aws sts get-caller-identity
```

2. ビルド後、使うプロファイル・利用可能リージョンを指定してデプロイします。以下の `us-east-1` は例です。初回はCLIがIAMロールとS3バケットを作成・再利用します。必要権限は公式作成手順を参照してください。

```bash
./scripts/build.sh
aws lambda-web deploy \
  --region us-east-1 \
  --name staticphp-frankenphp-poc \
  --code ./dist/package \
  --runtime nodejs24.x \
  --timeout-seconds 10 \
  --max-concurrency-per-environment 1 \
  --endpoint-name dev \
  --auth-type ApplicationManaged \
  --create
```

`ApplicationManaged` はこのアプリでは未認証の公開エンドポイントになります。`--create` はCLIの作成確認を省略するフラグです。初回の実験は環境あたり同時実行数1とし、その後に並列性を検証します。`--timeout-seconds` はリクエスト制限であり、起動期限10秒とは別です。既存のIAMロール・S3を使う場合は `--execution-role-arn`・`--bucket-name` を追加してください。

コストを抑える実験では `--auth-type IamAuth --max-environments 2 --rate-limit 100` を使用してください（AWS側の最小値）。IAM認証ではSigV4署名が必要になり、以下の通常curlとsmokeはそのままでは通りません。今回の検証はIAM認証と署名付きHTTPを使用し、6回だけ呼び出しました。上記のApplicationManagedの例は公開デモ用です。

3. CLIが返したURLを使い、HTTPSでPHPの応答を確認します。

```bash
export BASE_URL='https://YOUR-ENDPOINT-DOMAIN'
curl -i "$BASE_URL/hello"
node scripts/smoke.js
aws lambda-web get-web-function-endpoint \
  --region us-east-1 --function-name staticphp-frankenphp-poc --endpoint-name dev
```

`Active` 表示だけでは起動成功を証明しません。AWSはrevision作成時にサーバーが起動できるかを検証しないため、HTTP応答とログの両方を確認してください。ZIPアップロードはコンソールのWeb Functions → Create Web Function → Upload ZIPでも可能です。

更新も同じ `deploy` コマンドで新しいrevisionを作成します。AWS公式の [作成・更新手順](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-create.html) と [CLI deploy](https://docs.aws.amazon.com/cli/latest/reference/lambda-web/deploy.html) を参照してください。

## 制約と未検証事項

- AWSの東京リージョンで子プロセスの実行・指定ソケットの直接待ち受け・ルーティングを実測確認済みです。他リージョン・別バージョンでの挙動や正式サポートを保証しません。
- Dockerでの成功はWeb Functions実機の証明にはなりません。AWSのシグナル送信先、子の権限、環境再利用、障害後の再作成、実機のコールドスタートを検証してください。
- ランチャー内のローカルready計測と、エンドユーザーから見たコールドスタートを分けて測定してください。ソース再コンパイル経路の結果も既定ビルドとは別に記録してください。
- 並列処理・メモリ上限・高負荷・タイムアウト・長時間リクエスト・切断・ストリーミング・大きなbody・独自Hostは未検証。LaravelやComposerアプリ、永続ストレージも含みません。
- PHP拡張の量とPHP/Go/FrankenPHPの各バージョンは生成経路で異なり得ます。`php-cli -r 'echo PHP_VERSION, PHP_EOL; print_r(get_loaded_extensions());'` とバイナリハッシュを記録してください。
- 起動が失敗した場合は `ENOENT`（パスや実行形式）、`EACCES`（実行権限）、`exec format error`（CPU）、listen先、CLIオプション、書き込み先を順に確認してください。

実機結果は [docs/aws-verification.md](docs/aws-verification.md)、引き続き未検証の項目は [docs/validation.md](docs/validation.md) を参照してください。

## 後片付け

```bash
aws lambda-web delete-web-function \
  --region us-east-1 --function-name staticphp-frankenphp-poc
```

Web Functionの削除後も、IAMロール、S3オブジェクトと旧バージョン、CloudWatch Logsは残ります。共有リソースかを確認して個別に削除してください。

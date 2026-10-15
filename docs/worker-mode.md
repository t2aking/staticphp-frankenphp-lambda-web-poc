# 通常モードとWorker Modeの比較

2026-10-15にWorker Modeを追加し、Dockerで動作確認しました。その後、承認済みの4リクエストによるAWS検証も成功し、作成リソースを削除しました。[AWS結果](worker-aws.md)を参照してください。過去の [AWS成功記録](aws-verification.md) は追加前の通常モードの結果です。

## 変更点

- `FRANKENPHP_MODE=normal`（未指定時も同じ）: 従来の `php-server --listen … --root … --access-log`。
- `FRANKENPHP_MODE=worker`: 上記に `--worker /app/public/index.php,1` を追加。Worker数は1に固定。
- 両方で同じNodeランチャー・PHP入口・静的Arm64バイナリを使用。Nodeは起動・監視のみで、HTTPはFrankenPHPが直接処理。
- `/`・`/hello`・`/healthz` の既存JSONフィールドを維持し、`mode` を追加。エラー404/405とHEADも維持。
- `/state` は起動時ID `boot_id`、`/state` の呼び出し回数 `count`、現在のクエリ `marker` を返す比較専用エンドポイント。
- healthチェックはカウンターを増やさない。readinessはPHPが申告したモードと設定が一致した場合だけ成功する。

PHPの状態オブジェクトはリクエスト処理の外で初期化します。通常モードではスクリプト自体が毎回初期化され、Worker Modeでは `frankenphp_handle_request()` のコールバックでそのオブジェクトを繰り返し使います。

WorkerはPHPの実行コンテキスト／スレッドであり、`pid` だけでは通常モードとの違いを判定できません。この例では起動時IDとカウンターで確認します。

## ローカル手順

Docker・Buildx、Python 3が必要です。`compare-modes.js` は新規ローカル環境専用であり、AWSのURLには使用できません。プロジェクトルートから実行します。

```bash
npm test

docker buildx build --platform linux/arm64 --target local --load \
  -t staticphp-lambda-web-poc:worker-check .

python3 scripts/check-local.py
```

この検証スクリプトは通常とWorkerのコンテナを順番に起動し、既存HTTP smoke、状態比較、Workerのコンテナ再起動による状態リセット、SIGTERM正常終了を確認します。検証したコンテナは終了時に削除し、結果を `dist/worker-local-results.json` に保存します。大量リクエストや並列負荷は生成しません。worker_threads=1も起動ログから確認します。Workerの再起動はコンテナ再起動で行い、Worker単独再起動の試験ではありません。

手動でWorker Modeを起動する場合:

```bash
docker run --rm --name staticphp-worker-demo \
  --platform linux/arm64 --read-only --tmpfs /tmp:rw,nosuid,size=64m \
  --cap-drop ALL --security-opt no-new-privileges \
  -p 127.0.0.1:3000:3000 \
  -e FRANKENPHP_MODE=worker \
  -e AWS_LAMBDA_HTTP_ENDPOINT=0.0.0.0:3000 \
  staticphp-lambda-web-poc:worker-check
```

別ターミナルから:

```bash
curl -s 'http://127.0.0.1:3000/state?marker=first'
curl -s 'http://127.0.0.1:3000/state?marker=second'
curl -s 'http://127.0.0.1:3000/state'
# 同じboot_idでcountが1,2,3。markerはfirst,second,null。
# 自動比較は新しいコンテナに対して実行する（既にカウンターを進めた環境では失敗する）。
EXPECT_MODE=worker npm run compare
```

最後の自動比較を行う場合、上の手動curlを実行せず、新しいコンテナで実行してください。通常モードとの比較では起動時の `FRANKENPHP_MODE` と `EXPECT_MODE` を `normal` にします。

## 検証結果

| 項目 | 通常モード | Worker Mode（1 Worker） |
|---|---|---|
| `/`・`/hello`・`/healthz` | 200、既存JSONを維持 | 同じ |
| 不明パス / POST / HEAD | 404 / 405 / 200空本文 | 同じ |
| `/state` のcount | 1 → 1 → 1 | 1 → 2 → 3 |
| boot_id | リクエストごとに変更 | 同一Worker内で一定 |
| marker / request ID | そのリクエストの値 | そのリクエストの値、前回値を持ち越さない |
| ランチャー→PHP ready | 109ms | 58ms |
| SIGTERM→子の正常終了 | 約21ms、exit 0 | 約19ms、exit 0 |
| コンテナ再起動後 | ― | boot_id変更、countは再び1 → 2 → 3 |

数値は同一イメージでの単発観測で、性能優劣やAWSでのコールドスタート差を示しません。起動時間の測定範囲はNodeランチャー開始からPHP health応答までです。読み取り専用・非root・全capability削除・tmpfs /tmpで成功しました。

Nodeのテストは8件成功。既存5件に加えて、Worker CLI引数（数1）、不正モードの拒否、通常モードの応答をWorker readinessと誤認しないことを確認しました。

[ローカル実測JSON](worker-local-results.json)を保存しています。静的バイナリとFrankenPHP/PHPのバージョンは従来と同じ1.13.0 / 8.5.11です。Lambda用ZIPも更新できます。

```bash
./scripts/build.sh
```

## 状態保持の意味と制約

保持されるのは同じWorkerの存続中のメモリです。環境間では共有されず、Workerや実行環境が再起動されれば失われます。永続データやログイン状態をこのカウンターと同じ方法で保存する設計にはしません。`count` は `/state` へのHEADも含みますが、`/hello` とhealthは含みません。

意図的に保持するのはデモ用カウンターと起動時IDだけです。リクエストのクエリ値やrequest IDは毎回読み直します。例にはDB、フレームワーク、例外からの復旧・メモリリーク対策・Workerローテーションを含めていません。

仕様確認: [公式Worker Modeドキュメント](https://frankenphp.dev/docs/worker/)、[固定版CLI実装](https://github.com/php/frankenphp/blob/v1.13.0/caddy/php-server.go)。CLIのWorker指定は `script.php,1` です。`FRANKENPHP_CONFIG` は公式DockerイメージのCaddyfile向け設定であり、この静的CLIランチャーの切り替えには使用しません。

## AWSの最小追加検証案（承認後に実施済み）

以下は承認を受けて実施した範囲です。[結果と削除確認](worker-aws.md)を保存しています。今後の新たなAWS作成・更新・削除は、引き続き実行前に利用者へ確認します。

1. 検証用AWSプロファイル の東京リージョンに専用の一時Web Function、専用S3バケット、ログ専用IAMロール、CloudWatch Logsを作成。既存環境は変更しない。
2. `FRANKENPHP_MODE=worker`、Worker数1、環境あたり同時実行1、リクエスト制限5秒、IAM認証。環境数上限2と受付レート100/秒はAWSで設定可能な最小値。常時稼働を予約する設定ではない。
3. HTTPS `/hello` を1回、`/state` を3回、約1秒間隔で逐次呼び出す。AWS側の準備失敗や想定外応答なら負荷をかけず停止し、事前承認範囲の後片付けを行う。
4. AWSは最大2環境を起動し得るため、状態を `boot_id` ごとに分類する。同じIDでcountが増えることを確認。全体で単純に1,2,3となることは要求しない。3回で再利用を観測できなければ、追加呼び出しせず「確認できず」と報告。
5. `platform.initReport`、Worker数、mode、応答のrequest IDを保存し、専用リソースを削除。S3の全オブジェクトバージョン、IAMポリシーとロール、両ロググループも削除し、AWS APIで不在を再確認。

想定は1回のデプロイ・4リクエスト・数分以内の検証です。負荷試験、通常モードのAWS再検証、複数リージョン、CloudFront/NAT Gatewayは含めません。確定課金は反映後でなければ確認できません。再起動時リセット、長期メモリ使用、スケールゼロからの再起動、並列処理は今回の最小AWS検証から外し、未検証として残します。

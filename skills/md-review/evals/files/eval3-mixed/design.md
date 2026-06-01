# プロジェクト設計書

## 認証

JWT トークンで認証する。トークンの有効期限は 24 時間。

## データベース

PostgreSQL 14 を使用する。テーブルは初期段階では users / posts / comments の 3 つ。

## API

REST API として実装する。エンドポイントは `/api/v1/` 配下に置く。

## デプロイ

Docker コンテナとして配布。CI/CD は GitHub Actions で組む。

# 京成線・浅草線・総武線 トイレマップ

京成本線（京成上野〜成田空港）・京成押上線・都営浅草線（押上〜大門）・JR総武線（各駅停車 中野〜千葉）・JR総武快速線（東京〜千葉）の各駅のトイレ情報をまとめた、スマホ向けの1ページサイトです。

- 駅・路線・トイレのデータは `index.html` の `const L`（路線）と `const S`（駅）にあります。
- わからない項目は推測で埋めず「未調査」のままにしています。
- 見た人がトイレ情報を送れます（`POST /api/reports`）。送られた情報はそのままは出さず、確認してから `S` に反映します。

## 動かしかた

```
npm install
node server.mjs        # http://localhost:8080
```

`DATABASE_URL` があれば PostgreSQL の `reports` テーブルに、無ければ `data/reports.jsonl` に保存します。

## 公開

https://keisei-toilet-map.pokapon.com/

VPS 上の Coolify で動かしています。`main` に push すると自動でデプロイされます（`Dockerfile`、ポート 8080）。

## 届いた情報を見る

```
ssh -i ~/.ssh/id_ed25519_sakura ubuntu@133.167.45.124 \
  "docker exec re7wumlbubvtf4paoyetsb3n psql -U pokapon -d keisei_toilet_map -c \"select * from reports where status='new' order by id;\""
```

反映したら `status` を `done`（採用）か `rejected`（見送り）にします。

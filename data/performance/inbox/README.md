# Performance inbox

Drop daily ad exports here, then click **Sync now** on the dashboard's Performance page.

- **Meta Ads Manager**: Reports → breakdown *By time: Day* → Export table data as CSV.
  Include at least: Day, Ad name, Ad ID, Impressions, Amount spent, Link clicks,
  3-second video plays, ThruPlays, Video plays at 25%/100%, Purchases (or Results), Purchases conversion value.
- **Google Ads**: Ads & assets → segment *Day* → Download CSV.
  Include: Day, Ad, Ad ID, Campaign, Ad group, Impr., Cost, Clicks, Views, View rate,
  Video played to 25%/100%, Conversions, Conv. value.

Name files `meta-<anything>.csv` or `google-<anything>.csv` if auto-detection fails.
English and German column names both work. A file is imported once; edit or replace it to re-import.
Ad names that contain a project ID from `data/ads/` (for example `test_2026_10_11_h1_c2_9x16`) are linked to that project automatically.

# HeyGen Avatar API — Agent Reference

Use this when selecting avatars for German training ads via the AI Ad Factory dashboard or CLI.

## Authentication

All requests require header:

```
X-Api-Key: <HEYGEN_API_KEY>
```

Set in `.env` as `HEYGEN_API_KEY`. Default avatar fallback: `HEYGEN_AVATAR_ID`.

## List available avatars

Avatars are exposed as "looks" (API v3, cursor-paginated):

```http
GET https://api.heygen.com/v3/avatars/looks?ownership=public&avatar_type=studio_avatar&limit=50&token={NEXT_TOKEN}
X-Api-Key: {HEYGEN_API_KEY}
```

Response shape:

```json
{
  "data": [
    {
      "id": "8ae04ac4c6cf4c178995f509a5a85664",
      "name": "Josh",
      "preview_image_url": "https://...",
      "gender": "male",
      "supported_api_engines": ["avatar_iv"]
    }
  ],
  "has_more": true,
  "next_token": "..."
}
```

Single look: `GET /v3/avatars/looks/{id}`. Balance: `GET /v3/users/me`.

Cached locally at `data/avatars.json` after first fetch.

### CLI

```bash
pnpm avatars          # fetch + cache avatar list
pnpm dashboard        # pick avatar in web UI
```

## Generate avatar video (audio-driven)

We **never** use HeyGen TTS. Flow:

1. ElevenLabs generates German MP3 + word timestamps
2. Upload MP3 to HeyGen asset API
3. Generate video with avatar lip-syncing to uploaded audio

```http
POST https://api.heygen.com/v3/assets
X-Api-Key: {HEYGEN_API_KEY}
Idempotency-Key: {KEY}
Content-Type: multipart/form-data   (field: file = the MP3/WAV)
```

Returns `{ "data": { "asset_id": "..." } }`.

```http
POST https://api.heygen.com/v3/videos
X-Api-Key: {HEYGEN_API_KEY}
Idempotency-Key: {KEY}
Content-Type: application/json

{
  "type": "avatar",
  "avatar_id": "{AVATAR_ID}",
  "audio_asset_id": "{ASSET_ID}",
  "aspect_ratio": "9:16",
  "resolution": "1080p",
  "fit": "cover",
  "output_format": "mp4",
  "engine": { "type": "avatar_iv" }
}
```

Returns `{ "data": { "video_id": "..." } }`. Poll status:

```http
GET https://api.heygen.com/v3/videos/{VIDEO_ID}
```

Statuses: `pending` → `processing` → `completed` (with `video_url`) | `failed`

## Selecting avatars in this project

| Method | How |
|--------|-----|
| **Dashboard** | Open http://localhost:3847 → project → Avatar dropdown |
| **metadata.json** | Set `avatar.heygenAvatarId` in `video/<id>/metadata.json` |
| **Batch** | `pnpm batch` auto-picks 3 different avatars from cached list |
| **Agent** | Read `data/avatars.json`, set `heygenAvatarId` per job, run `pnpm produce <id>` |

## Metadata fields (per video)

```json
{
  "avatar": {
    "heygenAvatarId": "8ae04ac4c6cf4c178995f509a5a85664",
    "name": "Josh"
  },
  "introMs": 6000,
  "music": { "enabled": true, "volume": 0.4, "file": "data/music/funk-bed.mp3" },
  "captions": { "presetId": "gold-pop", "fontSize": 44 }
}
```

## Tips for German training ads

- v3 has no `avatar_style`/background fields; the avatar renders full-frame (`fit: cover`)
- Keep scripts under ~420 chars for ~30s max duration
- `introMs`: 5000–7000 — avatar visible only this long; voice continues over B-roll

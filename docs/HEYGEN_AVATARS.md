# HeyGen Avatar API — Agent Reference

Use this when selecting avatars for German training ads via the AI Ad Factory dashboard or CLI.

## Authentication

All requests require header:

```
X-Api-Key: <HEYGEN_API_KEY>
```

Set in `.env` as `HEYGEN_API_KEY`. Default avatar fallback: `HEYGEN_AVATAR_ID`.

## List available avatars

```http
GET https://api.heygen.com/v2/avatars
X-Api-Key: {HEYGEN_API_KEY}
```

Response shape:

```json
{
  "data": {
    "avatars": [
      {
        "avatar_id": "8ae04ac4c6cf4c178995f509a5a85664",
        "avatar_name": "Josh",
        "preview_image_url": "https://...",
        "gender": "male"
      }
    ]
  }
}
```

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
POST https://upload.heygen.com/v1/asset
X-Api-Key: {HEYGEN_API_KEY}
Content-Type: audio/mpeg
Body: <raw mp3 bytes>
```

```http
POST https://api.heygen.com/v2/video/generate
X-Api-Key: {HEYGEN_API_KEY}
Content-Type: application/json

{
  "video_inputs": [{
    "character": {
      "type": "avatar",
      "avatar_id": "{AVATAR_ID}",
      "avatar_style": "normal"
    },
    "voice": {
      "type": "audio",
      "audio_asset_id": "{ASSET_ID}"
    },
    "background": {
      "type": "color",
      "value": "#00FF00"
    }
  }],
  "dimension": { "width": 720, "height": 1280 }
}
```

Poll status:

```http
GET https://api.heygen.com/v1/video_status.get?video_id={VIDEO_ID}
```

Statuses: `waiting` → `processing` → `completed` | `failed`

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

- Prefer **normal** avatar_style for talking-head intros
- Green background `#00FF00` — avatar hidden after intro by B-roll overlay
- Keep scripts under ~420 chars for ~30s max duration
- `introMs`: 5000–7000 — avatar visible only this long; voice continues over B-roll

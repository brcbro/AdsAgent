# Competitor creatives

Drop competitor video ads here as `<name>.mp4` (or .mov / .webm). Add the German transcript as
`<name>.txt` next to the file, or set `WHISPER_CMD` in `.env` to transcribe locally, for example:

    WHISPER_CMD=whisper {file} --language de --model small --output_format txt --output_dir {dir}

Each file is torn down (hook / body / CTA, angle, persona, pacing) on the next **Run teardowns**
and shows up as example material on the Performance page. Competitor ads have no metrics, so they
never affect the lift numbers of the Winning Patterns.

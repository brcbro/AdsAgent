import { refreshAvatarCatalog } from "./avatar-catalog.js";

async function main() {
  const { avatars, privateCount, privateError, defaultRepaired, defaultAvatarId } = await refreshAvatarCatalog(count => console.log(`Read ${count} HeyGen v3 presenters…`));
  console.log(`Saved ${avatars.length} public HeyGen avatars → data/avatars.json`);
  console.log(privateError ? `Could not read your own avatars: ${privateError}` : `Saved ${privateCount} of your own HeyGen avatars → data/avatars-private.json`);
  if (defaultRepaired) console.log(`Replaced unavailable default presenter with ${defaultAvatarId}`);
  for (const a of avatars.slice(0, 10)) {
    console.log(`  ${a.avatar_id}  ${a.avatar_name}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

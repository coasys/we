export async function printBuildBanner(pkg: { name: string; version: string }) {
  const { name } = pkg;
  // ANSI escape codes for styling
  const green = '\x1b[32m';
  const bold = '\x1b[1m';
  const reset = '\x1b[0m';

  // Emojis
  // 🚀 🌎 🌌 👨‍💻 ✨ 🏗

  // Calculate padding and box dimensions
  const sidePadding = 4;
  const plainContent = `🚀✨  BUILDING ${name}  🚀✨`;
  const paddedContent = ' '.repeat(sidePadding) + plainContent + ' '.repeat(sidePadding);
  const boxWidth = paddedContent.length + 2; // Adjust offset to fit plain content

  // Inject ANSI codes after padding calculation to preserve alignment
  const displayContent = paddedContent.replace(name, `${bold}${name}${reset}${green}`);

  // Print the banner with color reset at the end of each line
  console.log(`${green}╔${'═'.repeat(boxWidth)}╗${reset}`);
  console.log(`${green}║${displayContent}║${reset}`);
  console.log(`${green}╚${'═'.repeat(boxWidth)}╝${reset}`);
}

export type Chunk = {
  id: string;
  file: string;
  heading: string;
  text: string;
};

const MAX_WORDS = 400;

function wordCount(s: string) { return s.split(/\s+/).filter(Boolean).length; }

export function chunkMarkdown(filePath: string, content: string): Chunk[] {
  const fileName = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
  const lines = content.split('\n');
  const chunks: Chunk[] = [];

  let currentHeading = fileName.replace(/\.md$/i, '');
  let buffer: string[] = [];
  let chunkIndex = 0;

  function flush() {
    const text = buffer.join('\n').trim();
    if (text.length < 20) return;
    chunks.push({
      id:      `${filePath}::${chunkIndex++}`,
      file:    filePath,
      heading: currentHeading,
      text:    `# ${currentHeading}\n\n${text}`,
    });
    buffer = [];
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      if (wordCount(buffer.join(' ')) >= MAX_WORDS) flush();
      currentHeading = headingMatch[2].trim();
    } else {
      buffer.push(line);
      if (wordCount(buffer.join(' ')) >= MAX_WORDS) {
        flush();
      }
    }
  }
  flush();
  return chunks;
}

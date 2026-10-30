/** Whether a drag carries files (and not text or a link, which the Type field may take). */
export function carriesFiles(data: DataTransfer | null): boolean {
  return data !== null && [...data.types].includes('Files');
}

export function filesOf(data: DataTransfer): File[] {
  if (data.files.length > 0) return [...data.files];
  const files: File[] = [];
  for (const item of data.items) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

/** Whether a paste carries plain text too. */
export function carriesText(data: DataTransfer): boolean {
  try {
    return data.getData('text/plain') !== '';
  } catch {
    return false;
  }
}

export const dragHeldMs = 400;

/** Extensions accepted when attaching a file to a note. */
export const ATTACHABLE = [
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "pdf", "docx", "rtf", "odt", "txt", "md", "csv", "json",
  "rs", "py", "js", "ts", "tsx", "jsx", "go", "java", "c", "cpp", "html", "css", "toml", "yaml", "yml", "xml", "sh",
];

export const AUDIO_EXTS = ["mp3", "wav", "webm", "m4a", "ogg"];

/** Extensions accepted by the media library importer. */
export const IMPORTABLE = [...ATTACHABLE, ...AUDIO_EXTS];

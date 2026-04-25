export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export async function imageFileToDataUrl(file, { maxBytes = 5 * 1024 * 1024 } = {}) {
  if (!(file instanceof File)) throw new Error("Select an image file.");
  if (!String(file.type || "").startsWith("image/")) throw new Error("Only image files are allowed.");
  if (file.size > maxBytes) throw new Error("Image is too large. Please choose one under 5MB.");
  return readFileAsDataUrl(file);
}

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidEmail(value) {
  const email = normalizeEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizePhone(value) {
  return String(value ?? "").trim().replace(/[\s()-]/g, "");
}

export function isValidPhone(value) {
  return /^\+?\d{8,20}$/.test(normalizePhone(value));
}

export function isValidHttpsUrl(value, maxLength = 500) {
  const raw = String(value ?? "").trim();
  if (!raw) return true;
  if (raw.length > maxLength) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function validateInterviewScores(body = {}) {
  const keys = ["technical", "communication", "problemSolving", "domainKnowledge"];
  const scores = keys.map((key) => Number(body[key]));
  if (scores.some((score) => !Number.isInteger(score) || score < 0 || score > 10)) {
    return { error: "Enter all four scores between 0 and 10." };
  }
  return { scores, total: scores.reduce((sum, score) => sum + score, 0) };
}

export function decodeResumeUpload({ fileName, mimeType, fileBase64, maxBytes = MAX_RESUME_BYTES } = {}) {
  const name = String(fileName ?? "").trim();
  const mime = String(mimeType ?? "").trim().toLowerCase();
  const encoded = String(fileBase64 ?? "").trim();
  if (!name || !encoded) return { error: "Choose a PDF or DOCX resume to upload." };

  // Treat both POSIX and Windows separators as path separators. Only the basename is stored.
  const safeName = name.split(/[\\/]/).pop().slice(0, 180);
  const extension = safeName.slice(safeName.lastIndexOf(".")).toLowerCase();
  const allowed = (extension === ".pdf" && mime === PDF_MIME) || (extension === ".docx" && mime === DOCX_MIME);
  if (!allowed) return { error: "Only PDF and DOCX resumes are accepted." };

  const base64 = encoded.replace(/^data:[^;]+;base64,/i, "");
  if (!base64 || base64.length > Math.ceil(maxBytes * 4 / 3) + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) {
    return { error: `Resume must be a valid file no larger than ${Math.floor(maxBytes / (1024 * 1024))} MB.` };
  }

  const buffer = Buffer.from(base64, "base64");
  const canonical = buffer.toString("base64").replace(/=+$/, "");
  if (!buffer.length || buffer.length > maxBytes || canonical !== base64.replace(/=+$/, "")) {
    return { error: `Resume must be a valid file no larger than ${Math.floor(maxBytes / (1024 * 1024))} MB.` };
  }

  const validSignature = extension === ".pdf"
    ? buffer.subarray(0, 5).toString("ascii") === "%PDF-"
    : buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  if (!validSignature) return { error: "The file content does not match its selected PDF or DOCX format." };

  return { buffer, extension, fileName: safeName, mimeType: mime };
}

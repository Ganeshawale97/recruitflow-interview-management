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

export function validateCustomAnswers(fields = [], answers = {}) {
  const source = answers && typeof answers === "object" && !Array.isArray(answers) ? answers : {};
  const cleanAnswers = {};
  for (const field of Array.isArray(fields) ? fields : []) {
    const value = source[field.key];
    let normalized;
    if (field.type === "checkbox") {
      if (value == null) normalized = false;
      else if (typeof value === "boolean") normalized = value;
      else return { error: "Choose a valid checkbox value for " + field.label + "." };
    } else if (value == null) normalized = "";
    else if (typeof value === "string") normalized = value.trim();
    else if (typeof value === "number" && Number.isFinite(value)) normalized = String(value);
    else return { error: "Enter a valid answer for " + field.label + "." };

    if (field.required && (normalized === "" || normalized === false)) {
      return { error: "Please complete the required field: " + field.label };
    }
    if (typeof normalized === "string" && normalized.length > 2000) {
      return { error: "The answer for " + field.label + " is too long." };
    }
    if (field.type === "email" && normalized !== "" && !isValidEmail(normalized)) {
      return { error: "Enter a valid email address for " + field.label + "." };
    }
    if (field.type === "phone" && normalized !== "") normalized = normalizePhone(normalized);
    if (field.type === "phone" && normalized !== "" && !isValidPhone(normalized)) {
      return { error: "Enter a valid phone number for " + field.label + "." };
    }
    if (field.type === "number" && normalized !== "" && !Number.isFinite(Number(normalized))) {
      return { error: "Enter a valid number for " + field.label + "." };
    }
    if (field.type === "select" && normalized !== "" && !(Array.isArray(field.options) ? field.options : []).includes(normalized)) {
      return { error: "Choose a valid option for " + field.label + "." };
    }
    cleanAnswers[field.key] = normalized;
  }
  return { answers: cleanAnswers };
}

export function validateDateRange(startsAt, endsAt) {
  const start = startsAt ? Date.parse(startsAt) : null;
  const end = endsAt ? Date.parse(endsAt) : null;
  if (startsAt && !Number.isFinite(start)) return "Enter a valid event start date.";
  if (endsAt && !Number.isFinite(end)) return "Enter a valid event end date.";
  if (start !== null && end !== null && end <= start) return "End date must be after start date.";
  return null;
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

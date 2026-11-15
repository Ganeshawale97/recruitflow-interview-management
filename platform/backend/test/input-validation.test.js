import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RESUME_BYTES,
  decodeResumeUpload,
  isValidEmail,
  isValidHttpsUrl,
  isValidPhone,
  normalizeEmail,
  normalizePhone,
  validateCustomAnswers,
  validateDateRange,
  validateInterviewScores
} from "../input-validation.js";

const pdf = Buffer.from("%PDF-1.7\nRecruitFlow test").toString("base64");
const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]).toString("base64");

test("normalizes email casing and surrounding whitespace", () => {
  assert.equal(normalizeEmail("  USER@Example.COM "), "user@example.com");
});

test("accepts ordinary valid email addresses", () => {
  assert.equal(isValidEmail("person@example.org"), true);
});

test("rejects malformed email addresses", () => {
  for (const value of ["", "person", "person@", "@example.org", "person@example", "a b@example.org"]) {
    assert.equal(isValidEmail(value), false, value);
  }
});

test("rejects email addresses beyond the maximum length", () => {
  assert.equal(isValidEmail("a".repeat(245) + "@x.io"), false);
});

test("normalizes phone whitespace and common punctuation", () => {
  assert.equal(normalizePhone(" +91 (987) 654-3210 "), "+919876543210");
});

test("accepts normalized international phone numbers", () => {
  assert.equal(isValidPhone(" +91 (987) 654-3210 "), true);
});

test("accepts phone numbers without a country prefix", () => {
  assert.equal(isValidPhone("9876543210"), true);
});

test("rejects phone numbers containing letters", () => {
  assert.equal(isValidPhone("98765ABCDE"), false);
});

test("rejects phone numbers with misplaced plus signs", () => {
  assert.equal(isValidPhone("98+76543210"), false);
});

test("rejects phone numbers outside the supported length", () => {
  assert.equal(isValidPhone("1234567"), false);
  assert.equal(isValidPhone("1".repeat(21)), false);
});

test("accepts empty optional profile links", () => {
  assert.equal(isValidHttpsUrl(""), true);
});

test("accepts HTTPS profile links", () => {
  assert.equal(isValidHttpsUrl("https://github.com/example"), true);
});

test("rejects HTTP profile links", () => {
  assert.equal(isValidHttpsUrl("http://example.com"), false);
});

test("rejects non-web URL schemes", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,hello", "file:///etc/passwd"]) {
    assert.equal(isValidHttpsUrl(value), false);
  }
});

test("rejects profile links longer than the configured limit", () => {
  assert.equal(isValidHttpsUrl("https://example.com/" + "a".repeat(500)), false);
});

test("accepts four integer interview scores at their lower boundary", () => {
  assert.deepEqual(validateInterviewScores({ technical: 0, communication: 0, problemSolving: 0, domainKnowledge: 0 }), {
    scores: [0, 0, 0, 0], total: 0
  });
});

test("accepts four integer interview scores at their upper boundary", () => {
  assert.equal(validateInterviewScores({ technical: 10, communication: 10, problemSolving: 10, domainKnowledge: 10 }).total, 40);
});

test("calculates interview score totals", () => {
  assert.equal(validateInterviewScores({ technical: 8, communication: 7, problemSolving: 9, domainKnowledge: 6 }).total, 30);
});

test("rejects missing interview score categories", () => {
  assert.match(validateInterviewScores({ technical: 8 }).error, /four scores/);
});

test("rejects negative interview scores", () => {
  assert.match(validateInterviewScores({ technical: -1, communication: 5, problemSolving: 5, domainKnowledge: 5 }).error, /four scores/);
});

test("rejects interview scores above ten", () => {
  assert.match(validateInterviewScores({ technical: 11, communication: 5, problemSolving: 5, domainKnowledge: 5 }).error, /four scores/);
});

test("rejects fractional interview scores", () => {
  assert.match(validateInterviewScores({ technical: 8.5, communication: 5, problemSolving: 5, domainKnowledge: 5 }).error, /four scores/);
});

test("accepts a PDF with a matching MIME type and signature", () => {
  const result = decodeResumeUpload({ fileName: "resume.pdf", mimeType: "application/pdf", fileBase64: pdf });
  assert.equal(result.error, undefined);
  assert.equal(result.extension, ".pdf");
});

test("accepts a DOCX ZIP signature", () => {
  const result = decodeResumeUpload({ fileName: "resume.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileBase64: docx });
  assert.equal(result.error, undefined);
  assert.equal(result.extension, ".docx");
});

test("rejects mismatched resume extensions and MIME types", () => {
  assert.match(decodeResumeUpload({ fileName: "resume.pdf", mimeType: "text/plain", fileBase64: pdf }).error, /Only PDF and DOCX/);
});

test("rejects an unsupported resume extension", () => {
  assert.match(decodeResumeUpload({ fileName: "resume.exe", mimeType: "application/pdf", fileBase64: pdf }).error, /Only PDF and DOCX/);
});

test("rejects a PDF without a PDF signature", () => {
  const fake = Buffer.from("not a pdf").toString("base64");
  assert.match(decodeResumeUpload({ fileName: "resume.pdf", mimeType: "application/pdf", fileBase64: fake }).error, /does not match/);
});

test("rejects a DOCX without a ZIP signature", () => {
  const fake = Buffer.from("not a zip").toString("base64");
  assert.match(decodeResumeUpload({ fileName: "resume.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileBase64: fake }).error, /does not match/);
});

test("rejects empty and missing resume payloads", () => {
  assert.match(decodeResumeUpload({}).error, /Choose a PDF/);
  assert.match(decodeResumeUpload({ fileName: "resume.pdf", mimeType: "application/pdf", fileBase64: "" }).error, /Choose a PDF/);
});

test("rejects malformed base64 input", () => {
  assert.match(decodeResumeUpload({ fileName: "resume.pdf", mimeType: "application/pdf", fileBase64: "%%%not-base64%%%" }).error, /valid file/);
});

test("rejects resumes larger than the configured maximum", () => {
  const oversized = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MAX_RESUME_BYTES)]).toString("base64");
  assert.match(decodeResumeUpload({ fileName: "resume.pdf", mimeType: "application/pdf", fileBase64: oversized }).error, /valid file/);
});

test("strips path components from uploaded resume names", () => {
  const result = decodeResumeUpload({ fileName: "../../private/resume.pdf", mimeType: "application/pdf", fileBase64: pdf });
  assert.equal(result.fileName, "resume.pdf");
});

test("accepts event date ranges when both dates are omitted", () => {
  assert.equal(validateDateRange(null, null), null);
});

test("accepts a valid event date range", () => {
  assert.equal(validateDateRange("2026-12-01T09:00:00Z", "2026-12-01T18:00:00Z"), null);
});

test("rejects invalid event start dates", () => {
  assert.match(validateDateRange("not-a-date", "2026-12-01T18:00:00Z"), /start date/);
});

test("rejects invalid event end dates", () => {
  assert.match(validateDateRange("2026-12-01T09:00:00Z", "not-a-date"), /end date/);
});

test("rejects an event end date equal to or before its start", () => {
  assert.match(validateDateRange("2026-12-01T09:00:00Z", "2026-12-01T09:00:00Z"), /after start/);
  assert.match(validateDateRange("2026-12-01T10:00:00Z", "2026-12-01T09:00:00Z"), /after start/);
});

test("normalizes optional custom text answers", () => {
  const result = validateCustomAnswers([{ key: "bio", label: "Biography", type: "textarea" }], { bio: "  Hello  " });
  assert.deepEqual(result.answers, { bio: "Hello" });
});

test("requires configured mandatory custom answers", () => {
  const result = validateCustomAnswers([{ key: "department", label: "Department", type: "text", required: true }], {});
  assert.match(result.error, /Department/);
});

test("preserves an explicitly unchecked optional checkbox", () => {
  const result = validateCustomAnswers([{ key: "consent", label: "Consent", type: "checkbox" }], { consent: false });
  assert.deepEqual(result.answers, { consent: false });
});

test("rejects string values for checkbox fields", () => {
  const result = validateCustomAnswers([{ key: "consent", label: "Consent", type: "checkbox" }], { consent: "false" });
  assert.match(result.error, /checkbox value/);
});

test("validates custom select answers against configured options", () => {
  const field = [{ key: "year", label: "Year", type: "select", options: ["First", "Second"] }];
  assert.deepEqual(validateCustomAnswers(field, { year: "Second" }).answers, { year: "Second" });
  assert.match(validateCustomAnswers(field, { year: "Third" }).error, /valid option/);
});

test("validates custom email answers", () => {
  const field = [{ key: "contact", label: "Contact email", type: "email" }];
  assert.deepEqual(validateCustomAnswers(field, { contact: "user@example.com" }).answers, { contact: "user@example.com" });
  assert.match(validateCustomAnswers(field, { contact: "not-an-email" }).error, /valid email/);
});

test("validates custom phone answers", () => {
  const field = [{ key: "mobile", label: "Mobile", type: "phone" }];
  assert.deepEqual(validateCustomAnswers(field, { mobile: "+91 9876543210" }).answers, { mobile: "+919876543210" });
  assert.match(validateCustomAnswers(field, { mobile: "letters-only" }).error, /valid phone/);
});

test("rejects non-numeric custom number answers", () => {
  const field = [{ key: "experience", label: "Experience", type: "number" }];
  assert.deepEqual(validateCustomAnswers(field, { experience: "2.5" }).answers, { experience: "2.5" });
  assert.match(validateCustomAnswers(field, { experience: "many" }).error, /valid number/);
});

test("rejects custom answers longer than 2,000 characters", () => {
  const field = [{ key: "details", label: "Details", type: "textarea" }];
  assert.match(validateCustomAnswers(field, { details: "x".repeat(2001) }).error, /too long/);
});

test("does not accept arrays as custom answer objects", () => {
  const field = [{ key: "name", label: "Name", type: "text", required: true }];
  assert.match(validateCustomAnswers(field, ["unexpected"]).error, /Name/);
});

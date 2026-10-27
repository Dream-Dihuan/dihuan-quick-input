export function detectBrowserName(userAgent: string): string {
  if (/Edg\//i.test(userAgent)) return 'Edge'
  if (/OPR\//i.test(userAgent)) return 'Opera'
  if (/Chrome\//i.test(userAgent)) return 'Chrome'
  if (/Chromium\//i.test(userAgent)) return 'Chromium'
  return 'Unknown'
}

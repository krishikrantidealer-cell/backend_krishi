const path = require('path');
const fs = require('fs');

const FALLBACK_SERVICE_ACCOUNT = {
  type: "service_account",
  project_id: "krishidealer",
  private_key_id: "b754cac7ec3e729ec9c5aa3459e09aecfadb35d5",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDz3ai4BvI7vZvL\nJJvZFPNuXvW7xgg82JEXWHUbup2Yq5i//ZGA0B3UI7KkXwovQL+50PYXWSCSOg6W\nfw3KiktdlERqhFNz2sfCY780OTDxPnqenTvOT/YL8Kmr6Hr6I0vXjTS9EAYIDU5P\nTyvqPI325PLiTk3wPxGbbWWDTuaW2rypgz8iGZw4EIyrbEVXY0lsDDvKQ9eA5m2a\nvn6Qlezkcdv531nHEtDm8kajrqZuU6PC4A+6kJaMVj8+tS9RcDvt1Los46asKAUX\nGEHeHb5zkzos87Bea87LPqXu17thwvP9xgRjJGxWR0wDJ6Zr2SlT59FVm1FtvaOs\nfY2A7B4LAgMBAAECggEAIs74VrAzIkDZvIDQuAcsCgyG4dMN+PVmnGD1ckxMU27m\n4jyk6LCMGWwxAxJHx1/kHfdMMR/5LLYZv/SJuOfNgyF3NIcHzGkli0MmlyM0r7Kd\n2QcTcsrqEWE8LrwD1bF1EWLn7LadTcfsbhicaZZUIzIh0xifOlQeRMO0Mi5wboap\n/vVAr4WKEzUHffWQHpiySuLJJJwS0yZeXZcwg7WIs3enhQKUo7g5xtWSqspM34cs\nDf2tZ04SGEH9dyw3LtLUhBSPG3zLYfXrZKVAreFP6B2+SKvCc+ziBT9o+vqPvGBL\nmkZXf51Jb3mvew6FEUgwW+G53e5aDgseZl0hNu5bcQKBgQD/z8+AipNdqr5NZj5H\n5/qQ3Jk/jO7oprN4lhJDntlurnO+l7TFH/rxdz2jwHrqlMKP6weuSJKwyDeWPXxQ\ncH2c4inzKCa9qQs4BWMSiYI6QSTZzTKmj4rFIP/VIrwoZoa0aLaYvkGg/CBcpC9M\nBoFW3IgFcV17zT4FXuoJSOepcQKBgQD0C5kga25IRipeYuJtzDbEM9nv9HLmsOXP\nfHfZDptMxfVGl8nLgCsHilLbD55q6wn7AOqACqEStONSzzt18NVpc2JVSDL1jX8l\nh5XCXfsSiDwX3mszKuPGoI89Un1jzaDSJEVMM3+oZeAVmGmUIYWWuSk1B4ZQp+x7\n4F6PZXihOwKBgQDG8b7WoO7qsZc+an2VPnxHnMgx/FDw7nQ1G8EohaljwpiRaTpU\n9AIdODbf2xm8xeRqOMbIa/hpM8zHMxozFMkb8WfeiyNV7Nmkv8vE5tw4oeEe4c66\nanfpxzgvccwTP2kTdTxMneo8YNhqM+X0ojqEaw397aReW8gYNTCd9+zygQKBgQCQ\nRTb98mSct1YevEhtbldF//0rnJA8joEc+tEC8V6fsTtBw0PZWOiXKY+3zvDw9gfN\nago3LZFxNJxafQYCwB/5meuczPTLMx3iOtgusk5V81HLLoKjGgzThGGJd/WGha43\n7JdG5/7kt20UdyibGIIXy1hv8AXYMp1b0hU0omEAtwKBgQDi1JLcAwk43xS8XdxZ\nAPz4Eep4GFlIOk8/bEFBOS/8leWL//bmfUDfV9fQlrbuJRJvB2WEazkTjsUAMFcK\nt01xCmsYpdZhjt6DlrFl7igSjwH57bnLes6WkoV6RGaUxN9xF6M7DTYjyZUFC4Ou\n/bBksLspsh+kr07ekShpt6Ui1w==\n-----END PRIVATE KEY-----\n",
  client_email: "firebase-adminsdk-fbsvc@krishidealer.iam.gserviceaccount.com",
  client_id: "115819036320277102581",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40krishidealer.iam.gserviceaccount.com",
  universe_domain: "googleapis.com"
};

function getServiceAccountCredentials() {
  const envKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (envKey) {
    try {
      return typeof envKey === 'string' ? JSON.parse(envKey) : envKey;
    } catch (e) {
      console.error('[Auth] Failed to parse service account JSON from env:', e.message);
    }
  }

  const keyFilePath = path.join(__dirname, '../serviceAccountKey.json');
  if (fs.existsSync(keyFilePath)) {
    try {
      return JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
    } catch (e) {
      console.error('[Auth] Failed to read local serviceAccountKey.json:', e.message);
    }
  }

  return FALLBACK_SERVICE_ACCOUNT;
}

module.exports = {
  getServiceAccountCredentials,
  FALLBACK_SERVICE_ACCOUNT
};

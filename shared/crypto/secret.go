package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
)

// EncryptSecret/DecryptSecret protect sensitive settings (Cloudflare API token, zone ID)
// at rest using AES-256-GCM. keySeed is any secret string from the environment (e.g.
// SETTINGS_ENCRYPTION_KEY) — it's hashed down to a 32-byte key so ops never has to
// generate/manage a precisely-formatted key.

func deriveKey(keySeed string) []byte {
	sum := sha256.Sum256([]byte(keySeed))
	return sum[:]
}

func EncryptSecret(plaintext, keySeed string) (string, error) {
	block, err := aes.NewCipher(deriveKey(keySeed))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.RawStdEncoding.EncodeToString(ciphertext), nil
}

func DecryptSecret(encoded, keySeed string) (string, error) {
	block, err := aes.NewCipher(deriveKey(keySeed))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	data, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	if len(data) < gcm.NonceSize() {
		return "", errors.New("crypto: ciphertext too short")
	}
	nonce, ciphertext := data[:gcm.NonceSize()], data[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

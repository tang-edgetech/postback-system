package idgen

import (
	"crypto/rand"
	"math/big"
)

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

// New returns a cryptographically random mixed-case alphanumeric string of the given
// length — used for link slugs, TIDs, and CIDs. Callers are responsible for retrying on
// a unique-constraint collision (astronomically rare at this alphabet/length; the DB
// unique index is the actual guarantee, this is just generation).
func New(length int) (string, error) {
	result := make([]byte, length)
	max := big.NewInt(int64(len(alphabet)))
	for i := range result {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		result[i] = alphabet[n.Int64()]
	}
	return string(result), nil
}

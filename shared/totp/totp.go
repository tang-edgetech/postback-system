package totp

import (
	"bytes"
	"encoding/base64"
	"image/png"

	"github.com/pquerna/otp/totp"
)

type Enrollment struct {
	Secret    string
	QRDataURI string
}

// Generate creates a new TOTP secret plus a ready-to-embed QR code (as a data: URI)
// for authenticator apps (Google Authenticator, Authy, etc). accountName is shown
// inside the app next to the issuer, so users can tell which system this code is for.
func Generate(issuer, accountName string) (Enrollment, error) {
	key, err := totp.Generate(totp.GenerateOpts{Issuer: issuer, AccountName: accountName})
	if err != nil {
		return Enrollment{}, err
	}
	img, err := key.Image(256, 256)
	if err != nil {
		return Enrollment{}, err
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return Enrollment{}, err
	}
	dataURI := "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
	return Enrollment{Secret: key.Secret(), QRDataURI: dataURI}, nil
}

func Validate(code, secret string) bool {
	return totp.Validate(code, secret)
}

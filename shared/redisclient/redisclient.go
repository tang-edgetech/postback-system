package redisclient

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

func Connect(addr string) (*redis.Client, error) {
	client := redis.NewClient(&redis.Options{
		Addr: addr,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, err
	}
	return client, nil
}

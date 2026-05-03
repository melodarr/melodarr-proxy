const { getAppVersion } = require('./utils/version')
const {
  LIDARR_LOOKUP_ARTIST_DEFAULTS,
  LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS
} = require('./utils/lidarrArtist')

const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Melodarr Proxy API',
    version: getAppVersion(),
    description: 'Operator, debug, and Lidarr-style metadata endpoints for Melodarr Proxy.'
  },
  servers: [
    {
      url: '/',
      description: 'Current proxy'
    }
  ],
  tags: [
    { name: 'Public', description: 'Public health and version endpoints' },
    { name: 'Metadata', description: 'Lidarr-style metadata proxy endpoints' },
    { name: 'Debug', description: 'Operator diagnostics and provider testing' },
    { name: 'Settings', description: 'Runtime configuration and admin setup' },
    { name: 'Control', description: 'Local runtime controls' },
    { name: 'Updates', description: 'Release checks and operator-triggered updates' }
  ],
  components: {
    securitySchemes: {
      apiKeyHeader: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Api-Key',
        description: 'API key created from Settings.'
      },
      apiKeyQuery: {
        type: 'apiKey',
        in: 'query',
        name: 'api_key',
        description: 'Fallback for clients that cannot set custom headers.'
      }
    },
    schemas: {
      Health: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          redis: { type: 'string', example: 'up' },
          upstream: { type: 'string', example: 'reachable' }
        }
      },
      ProviderSummary: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'musicbrainz' },
          score: { type: 'number', example: 95 },
          albumCount: { type: 'integer', example: 18 }
        }
      },
      Album: {
        type: 'object',
        properties: {
          title: { type: 'string', example: 'OK Computer' },
          id: { type: 'string' },
          firstReleaseDate: { type: 'string', example: '1997' },
          coverUrl: { type: 'string', format: 'uri' },
          provider: { type: 'string', example: 'musicbrainz' },
          ids: { type: 'object', additionalProperties: true }
        }
      },
      ArtistLookupResponse: {
        type: 'object',
        required: LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS,
        properties: {
          artistName: { type: 'string', example: 'Radiohead' },
          id: { type: 'string' },
          foreignArtistId: { type: 'string' },
          status: { type: 'string', example: LIDARR_LOOKUP_ARTIST_DEFAULTS.status },
          aliases: {
            type: 'array',
            items: { type: 'string' }
          },
          artistAliases: {
            type: 'array',
            items: { type: 'string' }
          },
          links: {
            type: 'array',
            items: { type: 'object', additionalProperties: true }
          },
          providers: {
            type: 'array',
            items: { $ref: '#/components/schemas/ProviderSummary' }
          },
          albums: {
            type: 'array',
            items: { $ref: '#/components/schemas/Album' }
          },
          images: {
            type: 'array',
            items: { type: 'object', additionalProperties: true }
          },
          partial: { type: 'boolean' },
          warning: { type: ['string', 'null'] }
        }
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' }
        }
      }
    }
  },
  paths: {
    '/api/health': {
      get: {
        tags: ['Public'],
        summary: 'Health check',
        operationId: 'getHealth',
        responses: {
          200: {
            description: 'Health payload',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Health' }
              }
            }
          }
        }
      }
    },
    '/api/version': {
      get: {
        tags: ['Public'],
        summary: 'Version',
        operationId: 'getVersion',
        responses: {
          200: {
            description: 'Version payload',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    app: { type: 'string', example: 'Melodarr Proxy' },
                    version: { type: 'string', example: getAppVersion() },
                    environment: { type: 'string', example: 'production' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/v1/artist/lookup': {
      get: {
        tags: ['Metadata'],
        summary: 'Lookup artist albums',
        operationId: 'lookupArtist',
        security: [{ apiKeyHeader: [] }, { apiKeyQuery: [] }],
        parameters: [
          {
            name: 'term',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            example: 'Radiohead'
          },
          {
            name: 'debug',
            in: 'query',
            required: false,
            schema: { type: 'boolean' }
          }
        ],
        responses: {
          200: {
            description: 'Normalized artist metadata',
            headers: {
              'X-Cache': {
                schema: { type: 'string', enum: ['HIT', 'MISS'] }
              },
              'X-Providers': {
                schema: { type: 'string' }
              },
              'X-Cache-Generated-At': {
                schema: { type: 'string', format: 'date-time' }
              }
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ArtistLookupResponse' }
              }
            }
          },
          400: {
            description: 'Missing term',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/v1/artist/discover': {
      get: {
        tags: ['Metadata'],
        summary: 'Discover artists by artist, song, or album text',
        operationId: 'discoverArtist',
        security: [{ apiKeyHeader: [] }, { apiKeyQuery: [] }],
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' }, example: 'Paranoid Android' },
          { name: 'type', in: 'query', required: false, schema: { type: 'string', enum: ['artist', 'song', 'album'] } }
        ],
        responses: {
          200: {
            description: 'Artist candidates',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    query: { type: 'string' },
                    type: { type: 'string' },
                    candidates: { type: 'array', items: { type: 'object', additionalProperties: true } },
                    traceId: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/v1/song/albums': {
      get: {
        tags: ['Metadata'],
        summary: 'Find albums containing a song by artist',
        operationId: 'findSongAlbums',
        security: [{ apiKeyHeader: [] }, { apiKeyQuery: [] }],
        parameters: [
          { name: 'artist', in: 'query', required: true, schema: { type: 'string' }, example: 'Dave Edmunds' },
          { name: 'song', in: 'query', required: true, schema: { type: 'string' }, example: 'I Hear You Knocking' }
        ],
        responses: {
          200: {
            description: 'Albums containing the song',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    artist: { type: 'string' },
                    song: { type: 'string' },
                    source: { type: 'string' },
                    albums: { type: 'array', items: { type: 'object', additionalProperties: true } }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/debug/search': {
      get: {
        tags: ['Debug'],
        summary: 'Debug artist lookup with raw and normalized output',
        operationId: 'debugSearch',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' }, example: 'Radiohead' }
        ],
        responses: {
          200: {
            description: 'Debug lookup payload',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true
                }
              }
            }
          }
        }
      }
    },
    '/debug/song-albums': {
      get: {
        tags: ['Debug'],
        summary: 'Debug song-to-album lookup',
        operationId: 'debugSongAlbums',
        parameters: [
          { name: 'artist', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'song', in: 'query', required: true, schema: { type: 'string' } }
        ],
        responses: {
          200: {
            description: 'Song album debug payload',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true
                }
              }
            }
          }
        }
      }
    },
    '/debug/cache': {
      get: {
        tags: ['Debug'],
        summary: 'Cache state',
        operationId: 'debugCache',
        responses: {
          200: {
            description: 'Cache state payload',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true
                }
              }
            }
          }
        }
      }
    },
    '/debug/requests': {
      get: {
        tags: ['Debug'],
        summary: 'Recent request traces',
        operationId: 'debugRequests',
        responses: {
          200: {
            description: 'Request trace list',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { type: 'object', additionalProperties: true }
                }
              }
            }
          }
        }
      }
    },
    '/debug/upstream': {
      get: {
        tags: ['Debug'],
        summary: 'Recent upstream attempt history (ring buffer)',
        description: 'Returns recent per-attempt upstream entries from the in-memory ring buffer. One entry per HTTP attempt (so 3 retries = 3 entries that share a requestId). Newest first. Use to answer "is this failing every time? same IP? same step? same error?" without grepping logs.',
        operationId: 'getUpstreamHistory',
        parameters: [
          {
            name: 'provider',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Filter to a single provider (e.g. musicbrainz). Case-insensitive.'
          },
          {
            name: 'requestId',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Filter to a single request id. Use this to pull every attempt across every provider for one inbound request.'
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1 },
            description: 'Maximum number of entries to return (newest first). Defaults to maxSize.'
          }
        ],
        responses: {
          200: {
            description: 'Ring buffer query result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    entries: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          ts: { type: 'string', format: 'date-time' },
                          requestId: { type: 'string', description: 'Stable across retries within a single upstream call.' },
                          provider: { type: 'string' },
                          path: { type: 'string' },
                          attempt: { type: 'integer', minimum: 1 },
                          selectedAddress: { type: 'string', nullable: true },
                          selectedFamily: { type: 'integer', nullable: true, enum: [4, 6, null] },
                          failedStep: { type: 'string', nullable: true, enum: ['dns', 'tcp', 'tls', 'http', 'parse', null] },
                          error: {
                            type: 'object',
                            nullable: true,
                            properties: {
                              code: { type: 'string', nullable: true },
                              message: { type: 'string', nullable: true }
                            }
                          },
                          httpStatus: { type: 'integer', nullable: true },
                          durationMs: { type: 'integer' },
                          retryAfterMs: { type: 'integer', nullable: true, description: 'Parsed from the Retry-After response header on 429/503; null otherwise.' },
                          nextWaitMs: { type: 'integer', nullable: true, description: 'Sleep duration before the next attempt. null on the final attempt or successful entries.' }
                        }
                      }
                    },
                    filteredCount: { type: 'integer' },
                    totalCount: { type: 'integer' },
                    maxSize: { type: 'integer' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/debug/test-provider': {
      post: {
        tags: ['Debug'],
        summary: 'Test custom provider configuration',
        operationId: 'testProvider',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: true
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Provider test result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true
                }
              }
            }
          }
        }
      }
    },
    '/api/settings/status': {
      get: {
        tags: ['Settings'],
        summary: 'Settings auth/setup status',
        operationId: 'settingsStatus',
        responses: {
          200: {
            description: 'Settings status',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true }
              }
            }
          }
        }
      }
    },
    '/api/settings/runtime/{key}': {
      delete: {
        tags: ['Settings'],
        summary: 'Clear a saved runtime override',
        description: 'Removes a saved runtime override so the value falls back to the env var (if set) or the built-in default. Use when an env var is being shadowed by a previously-saved Settings UI value. The PATCH /api/settings endpoint also accepts `{ "key": null }` to clear an override in batch.',
        operationId: 'clearRuntimeSetting',
        parameters: [
          {
            name: 'key',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Editable runtime key (e.g. metadataProviders, providerPriority).'
          }
        ],
        responses: {
          200: {
            description: 'Override cleared (or no override existed)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    key: { type: 'string' },
                    cleared: { type: 'boolean', description: 'true if a saved value was removed; false if no override existed.' },
                    newValue: {},
                    newSource: { type: 'string', enum: ['env', 'default'] }
                  }
                }
              }
            }
          },
          404: {
            description: 'Unknown runtime key',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/update/status': {
      get: {
        tags: ['Updates'],
        summary: 'Check installed and latest release versions',
        operationId: 'getUpdateStatus',
        responses: {
          200: {
            description: 'Update status and changelog payload',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true }
              }
            }
          }
        }
      }
    },
    '/api/update/apply': {
      post: {
        tags: ['Updates'],
        summary: 'Apply the latest release update',
        operationId: 'applyUpdate',
        responses: {
          200: {
            description: 'Update result',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true }
              }
            }
          },
          409: {
            description: 'Update runner is unavailable',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/proxy/start': {
      post: {
        tags: ['Control'],
        summary: 'Start proxy',
        operationId: 'startProxy',
        responses: {
          200: {
            description: 'Control result',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true }
              }
            }
          }
        }
      }
    },
    '/api/proxy/stop': {
      post: {
        tags: ['Control'],
        summary: 'Stop proxy',
        operationId: 'stopProxy',
        responses: {
          200: {
            description: 'Control result',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true }
              }
            }
          }
        }
      }
    },
    '/api/cache/clear': {
      post: {
        tags: ['Control'],
        summary: 'Clear cache',
        operationId: 'clearCache',
        responses: {
          200: {
            description: 'Cache clear result',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true }
              }
            }
          }
        }
      }
    }
  }
}

module.exports = openApiDocument

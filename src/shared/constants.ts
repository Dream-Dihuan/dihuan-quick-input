export const PROTOCOL_VERSION = 1

export const DEFAULT_HOTKEY = 'CommandOrControl+Shift+Space'
export const DEFAULT_INSERT_MODE = 'caret'
export const DEFAULT_PORTS = Array.from({ length: 10 }, (_, index) => 47821 + index)

export const HEARTBEAT_INTERVAL_MS = 20_000
export const HEARTBEAT_MISS_LIMIT = 3
export const INSERT_TIMEOUT_MS = 3_000
export const HANDSHAKE_TIMEOUT_MS = 2_000
export const MAX_MESSAGE_BYTES = 64 * 1024
export const MAX_INSERT_TEXT_LENGTH = 10_000
export const PLUGIN_TIMEOUT_MS = 200
export const PLUGIN_LOAD_TIMEOUT_MS = 1_000
export const MAX_PLUGIN_FILE_BYTES = 1024 * 1024
export const MAX_COMMAND_RESULT_LENGTH = 10_000

export const SERVER_HOST = '127.0.0.1'

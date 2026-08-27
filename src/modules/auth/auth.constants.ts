/**
 * Session and credential parameters, declared once.
 *
 * These values were previously repeated across the service, the module, and the
 * controller in three different units, so the cookie could outlive the token it
 * carried. Every consumer now derives from here.
 */

export const ACCESS_TOKEN_LIFETIME = '15m';

export const REFRESH_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** The same duration in the string form the JWT signer expects. */
export const REFRESH_TOKEN_LIFETIME = '7d';

/**
 * bcrypt work factor for password hashing. 12 is the current default for
 * interactive logins; raising it invalidates nothing, since bcrypt hashes record
 * their own cost.
 */
export const PASSWORD_HASH_ROUNDS = 12;

/**
 * Refresh tokens are high-entropy values with a short life, so they do not need
 * the same work factor as a human-chosen password. A lower cost keeps token
 * rotation off the request critical path.
 */
export const REFRESH_TOKEN_HASH_ROUNDS = 10;

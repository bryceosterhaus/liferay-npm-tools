/**
 * © 2019 Liferay, Inc. <https://liferay.com>
 *
 * SPDX-License-Identifier: BSD-3-Clause
 */

const ReversibleMap = require('./ReversibleMap');
const permute = require('../utils/permute');

class Lexer {
	constructor(callback) {
		/**
		 * Map of all matchers keyed by name.
		 */
		this._matchers = new Map();

		this._callback = callback;
	}

	*lex(input) {
		const lookup = matcher => this.lookup(matcher);

		const setMatcher = (name, matcher) => this._matchers.set(name, matcher);

		/**
		 * Arbitrary metadata passed to matchers' `onMatch()` callbacks.
		 */
		const meta = new ReversibleMap();

		/**
		 * Returns a matcher that looks up another matcher by name and uses it.
		 */
		function a(matcherName) {
			return {
				get description() {
					return this._description || lookup(matcherName).description;
				},

				except,

				exec(string) {
					const matcher = lookup(matcherName);

					if (!matcher) {
						throw new Error(
							`Failed to find matcher with name ${name}`
						);
					}

					const match = matcher.exec(string);

					if (match !== null) {
						if (this._onMatch) {
							this._onMatch(match, meta);
						}
					}

					return match;
				},

				name,

				onMatch,

				until
			};
		}

		/**
		 * Returns a composite matcher that matches if all the passed `matchers` match,
		 * irrespective of order.
		 *
		 * This is an order-insensitive analog of `sequence()`.
		 *
		 * Note that permutating has O(!N) runtime, so should be used sparingly.
		 */
		function allOf(...matchers) {
			// Given matchers [a, b], permute them (eg. [[a, b], [b, a]])...
			const permutations = permute(matchers);

			// ...and transform into: oneOf(sequence(a, b), sequence(b, a)):
			const matcher = oneOf(...permutations.map(m => sequence(...m)));

			return {
				get description() {
					return (
						this._description ||
						'allOf:(' +
							matchers
								.map(matcher => lookup(matcher).description)
								.join(', ') +
							')'
					);
				},

				exec(string) {
					return matcher.exec(string);
				},

				name
			};
		}

		/**
		 * Returns a matcher that modifies the parent matcher by having it
		 * return `null` whenever the `predicate` matcher identifies a match.
		 */
		function except(predicate) {
			const parent = this;

			return {
				get description() {
					return (
						this._description || `^${lookup(parent).description}`
					);
				},

				exec(string) {
					const match = parent.exec(string);

					if (match !== null) {
						const negated = lookup(predicate).exec(string);

						if (negated !== null) {
							return null;
						}

						return match;
					}

					return null;
				},

				name,

				until
			};
		}

		/**
		 * Turns `stringOrRegExp` into a RegExp with additional properties
		 * (`description`, `onMatch`, `until` etc).
		 */
		function match(stringOrRegExp) {
			const pattern =
				typeof stringOrRegExp === 'string'
					? escape(stringOrRegExp)
					: stringOrRegExp.source;

			const matcher = new RegExp(`^${pattern}`, 'u');

			Object.defineProperty(matcher, 'description', {
				get: () => {
					return (
						matcher._description ||
						(typeof stringOrRegExp === 'string'
							? JSON.stringify(stringOrRegExp)
							: stringOrRegExp.toString())
					);
				}
			});

			matcher.exec = string => {
				const match = RegExp.prototype.exec.call(matcher, string);

				if (match !== null) {
					if (matcher._onMatch) {
						matcher._onMatch(match, meta);
					}
				}

				return match;
			};

			matcher.name = name.bind(matcher);

			matcher.onEnter = onEnter.bind(matcher);

			matcher.onMatch = onMatch.bind(matcher);

			matcher.until = until.bind(matcher);

			return matcher;
		}

		/**
		 * Returns a matcher that always matches. If the supplied `matcher` matches, we
		 * return the match, otherwise we return a zero-width match.
		 *
		 * Conceptually equivalent to the "?" regex special character.
		 */
		function maybe(matcher) {
			return {
				get description() {
					return (
						this._description || `${lookup(matcher).description}?`
					);
				},

				exec(string) {
					const match = lookup(matcher).exec(string);

					if (match !== null) {
						return match;
					} else {
						// Fake a zero-width match.
						return getMatchObject('');
					}
				},

				name
			};
		}

		/**
		 * Assigns a name to a matcher.
		 */
		function name(string) {
			this._description = string;

			setMatcher(string, this);

			return this;
		}

		/**
		 * Registers a callback to be invoked when a matcher is entered
		 * (immediately prior to attempting to detect a match).
		 */
		function onEnter(callback) {
			this._onEnter = callback;

			return this;
		}

		/**
		 * Registers a callback to be invoked when a matcher matches.
		 */
		function onMatch(callback) {
			this._onMatch = callback;

			return this;
		}

		/**
		 * Returns a composite matcher that matches if one of the supplied matchers
		 * matches.
		 */
		function oneOf(...matchers) {
			return {
				get description() {
					return (
						this._description ||
						matchers
							.map(matcher => lookup(matcher).description)
							.join(' | ')
					);
				},

				except,

				exec(string) {
					for (let i = 0; i < matchers.length; i++) {
						meta.checkpoint();

						const matcher = lookup(matchers[i]);

						const match = matcher.exec(string);

						if (match !== null) {
							return match;
						}

						meta.rollback();
					}

					return null;
				},

				name,

				test,

				until
			};
		}

		/**
		 * Returns a composite matcher that matches if the passed `matcher` matches at
		 * least once.
		 *
		 * Conceptually equivalent to the "+" regex special char.
		 */
		function repeat(matcher) {
			return {
				get description() {
					return (
						this._description || `${lookup(matcher).description}+`
					);
				},

				exec(string) {
					let remaining = string;
					let consumed = '';

					while (remaining !== '') {
						const match = lookup(matcher).exec(remaining);

						if (match !== null) {
							remaining = remaining.slice(match[0].length);

							consumed += match[0];
						} else {
							break;
						}
					}

					if (consumed) {
						return getMatchObject(consumed);
					} else {
						return null;
					}
				},

				name
			};
		}

		/**
		 * Returns a composite matcher that matches if all of the supplied matchers
		 * match, in order.
		 */
		function sequence(...matchers) {
			return {
				get description() {
					return (
						this._description ||
						matchers
							.map(matcher => lookup(matcher).description)
							.join(' ')
					);
				},

				exec(string) {
					meta.checkpoint();

					if (this._onEnter) {
						this._onEnter(meta);
					}

					let remaining = string;
					let matched = '';

					for (let i = 0; i < matchers.length; i++) {
						const matcher = lookup(matchers[i]);
						const match = matcher.exec(remaining);

						if (match !== null) {
							remaining = remaining.slice(match[0].length);

							matched += match[0];
						} else {
							meta.rollback();

							return null;
						}
					}

					const match = getMatchObject(matched);

					if (this._onMatch) {
						this._onMatch(match, meta);
					}

					return match;
				},

				name,

				onEnter,

				onMatch,

				test
			};
		}

		function test(string) {
			return this.exec(string) !== null;
		}

		/**
		 * Returns a matcher that modifies the parent matcher by having it
		 * repeat 0 or more times until the `predicate` matcher identifies a
		 * match.
		 */
		function until(predicate) {
			const parent = this;

			return {
				get description() {
					return (
						this._description ||
						`-> ${lookup(predicate).description}`
					);
				},

				exec(string) {
					let remaining = string;
					let consumed = '';

					while (remaining !== '') {
						let match = predicate.exec(remaining);

						if (match !== null) {
							remaining = remaining.slice(match[0].length);

							return getMatchObject(consumed + match[0]);
						}

						match = parent.exec(remaining);

						if (match !== null) {
							remaining = remaining.slice(match[0].length);

							consumed += match[0];
						} else {
							break;
						}
					}

					return null;
				},

				name
			};
		}

		let remaining = input;

		const atEnd = () => remaining.length === 0;

		/**
		 * Run a matcher at the current location and consume the input. If the
		 * matcher does not match, throws an error.
		 */
		const consume = matcher => {
			let result;

			// Potentially re-use result of preceeding `peek()`.
			const peeked = peek.peeked;
			delete peek.peeked;

			if (matcher === undefined) {
				// Return result of previous `peek()`.
				if (peeked != undefined) {
					result = peeked;
				} else {
					throw new Error(
						'Cannot consume() non-existent previous peek() result'
					);
				}
			} else {
				if (typeof matcher === 'string') {
					matcher = match(matcher);
				}

				result = matcher.exec(remaining);
			}

			if (result === null) {
				fail(matcher);
			}

			// TODO: Commit pending actions.
			remaining = remaining.slice(result[0].length);

			return result[0];
		};

		/**
		 * Reports a failure to match.
		 */
		const fail = reasonOrMatcher => {
			let reason;

			if (reasonOrMatcher.description) {
				reason = `Failed to match ${reasonOrMatcher.description}`;
			} else {
				reason = reasonOrMatcher;
			}

			// TODO: report index, maybe.
			const context =
				remaining.length > 20
					? `${remaining.slice(0, 20)}...`
					: remaining;

			throw new Error(`${reason} at: ${JSON.stringify(context)}`);
		};

		/**
		 * Performs lookahead by testing `matcher` at the current location in
		 * the input. Returns `true` to indicate whether there was a match.
		 *
		 * The peeked match if memoized, such that an immediately
		 * subsequent call to `consume()` without arguments will just access the
		 * memoized match instead of repeating the scan.
		 */
		const peek = matcher => {
			if (typeof matcher === 'string') {
				matcher = match(matcher);
			}

			// Memoize the result so that we can `consume()` it if desired.
			peek.peeked = matcher.exec(remaining);

			return peek.peeked !== null;
		};

		/**
		 * Produce an object reperesenting a token, given a token `name`
		 * and textual `contents`.
		 */
		const token = (name, contents) => {
			return {
				contents,
				index: input.length - remaining.length - contents.length,
				name
			};
		};

		/**
		 * API to be passed to the callback.
		 *
		 * Note that there are some internal functions that we don't pass
		 * (eg. except, name, until, test), but which are returned by other
		 * calls to the API. (eg. `match(...).until(...)`).
		 */
		const API = {
			a,
			allOf,
			atEnd,
			consume,
			fail,
			lookup,
			match,
			maybe,
			meta,
			oneOf,
			peek,
			repeat,
			sequence,
			token
		};

		const advance = this._callback(API);

		if (typeof advance !== 'function') {
			throw new Error(
				'Expected `new Lexer()` callback to return a function'
			);
		}

		while (!atEnd()) {
			const index = input.length - remaining.length;

			const token = advance();

			if (token) {
				if (
					typeof token.name === 'string' &&
					typeof token.contents === 'string' &&
					Number.isInteger(token.index)
				) {
					yield token;
				} else {
					fail(`Invalid token received at index ${index}`);
				}
			} else {
				fail('Failed to consume all input');
			}
		}
	}

	/**
	 * Look up a matcher by name.
	 */
	lookup(matcher) {
		if (typeof matcher === 'string' && this._matchers.has(matcher)) {
			return this._matchers.get(matcher);
		} else if (matcher && typeof matcher.exec === 'function') {
			return matcher;
		} else {
			throw new Error('Unable to look up matcher');
		}
	}
}

/**
 * Escapes `literal` for use in a RegExp.
 */
function escape(literal) {
	// https://github.com/benjamingr/RegExp.escape/blob/master/EscapedChars.md
	return literal.replace(/[\^$\\.*+?()[\]{}|]/g, '\\$&');
}

/**
 * Creates a fake "match" object that mimics what you would get from a call to
 * RegExp.prototype.exec().
 */
function getMatchObject(string) {
	// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec
	// TODO: needs index and input properties
	// might also want to set lastIndex on regexp
	return [string];
}

module.exports = Lexer;

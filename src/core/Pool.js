/**
 * Pool.js
 * ---------------------------------------------------------------
 * A tiny generic object pool. Avoids per-frame allocation hot spots
 * for projectiles / particles / floating texts.
 *
 * Usage:
 *   const pool = new Pool(() => new Projectile());
 *   const p = pool.acquire();
 *   pool.release(p);
 * ---------------------------------------------------------------
 */
export class Pool {
  constructor(factory, initialSize = 0) {
    this._factory = factory;
    this._items = [];
    for (let i = 0; i < initialSize; i++) this._items.push(factory());
  }

  acquire() {
    const item = this._items.pop();
    return item !== undefined ? item : this._factory();
  }

  release(item) {
    if (item.isPooled) return; // already returned
    this._items.push(item);
  }

  releaseAll(predicate = () => true) {
    for (const item of this._items) if (predicate(item)) item.onRecycle?.();
  }

  get size() {
    return this._items.length;
  }
}

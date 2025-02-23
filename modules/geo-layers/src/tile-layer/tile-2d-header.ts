/* eslint-env browser */
import {Layer, log} from '@deck.gl/core';
import {RequestScheduler} from '@loaders.gl/loader-utils';
import {TileBoundingBox, TileIndex, TileLoadProps} from './types';

export type TileLoadDataProps = {
  requestScheduler: RequestScheduler;
  getData: (props: TileLoadProps) => Promise<any>;
  onLoad: (tile: Tile2DHeader) => void;
  onError: (error: any, tile: Tile2DHeader) => void;
};
export default class Tile2DHeader {
  index: TileIndex;
  isVisible: boolean;
  isSelected: boolean;
  parent: Tile2DHeader | null;
  children: Tile2DHeader[] | null;
  content: any;
  state?: number;
  layers?: Layer[] | null;

  id!: string; // assigned _always_ with result of `getTileId`
  bbox!: TileBoundingBox; // assigned _always_ with result of `getTileMetadata`
  zoom!: number; // assigned _always_ with result of `getTileZoom`

  private _abortController: AbortController | null;
  private _loader: Promise<void> | undefined;
  private _loaderId: number;
  private _isLoaded: boolean;
  private _isCancelled: boolean;
  private _needsReload: boolean;

  constructor(index: TileIndex) {
    this.index = index;
    this.isVisible = false;
    this.isSelected = false;
    this.parent = null;
    this.children = [];

    this.content = null;

    this._loader = undefined;
    this._abortController = null;
    this._loaderId = 0;
    this._isLoaded = false;
    this._isCancelled = false;
    this._needsReload = false;
  }

  get data() {
    return this.isLoading && this._loader ? this._loader.then(() => this.data) : this.content;
  }

  get isLoaded() {
    return this._isLoaded && !this._needsReload;
  }

  get isLoading() {
    return Boolean(this._loader) && !this._isCancelled;
  }

  get needsReload() {
    return this._needsReload || this._isCancelled;
  }

  get byteLength() {
    const result = this.content ? this.content.byteLength : 0;
    if (!Number.isFinite(result)) {
      log.error('byteLength not defined in tile data')();
    }
    return result;
  }

  /* eslint-disable max-statements */
  private async _loadData({
    getData,
    requestScheduler,
    onLoad,
    onError
  }: TileLoadDataProps): Promise<void> {
    const {index, id, bbox} = this;
    const loaderId = this._loaderId;

    this._abortController = new AbortController();
    const {signal} = this._abortController;

    // @ts-expect-error (2345) Argument of type '(tile: any) => 1 | -1' is not assignable ...
    const requestToken = await requestScheduler.scheduleRequest(this, tile => {
      return tile.isSelected ? 1 : -1;
    });

    if (!requestToken) {
      this._isCancelled = true;
      return;
    }
    // A tile can be cancelled while being scheduled
    if (this._isCancelled) {
      requestToken.done();
      return;
    }

    let tileData = null;
    let error;
    try {
      tileData = await getData({index, id, bbox, signal});
    } catch (err) {
      error = err || true;
    } finally {
      requestToken.done();
    }

    // If loadData has been called with a newer version, discard the result from this operation
    if (loaderId !== this._loaderId) {
      return;
    }
    // Clear the `isLoading` flag
    this._loader = undefined;
    // Rewrite tile content with the result of getTileData if successful, or `null` in case of
    // error or cancellation
    this.content = tileData;
    // If cancelled, do not invoke the callbacks
    // Consider it loaded if we tried to cancel but `getTileData` still returned data
    if (this._isCancelled && !tileData) {
      this._isLoaded = false;
      return;
    }
    this._isLoaded = true;
    this._isCancelled = false;

    if (error) {
      onError(error, this);
    } else {
      onLoad(this);
    }
  }

  loadData(opts: TileLoadDataProps): Promise<void> {
    this._isLoaded = false;
    this._isCancelled = false;
    this._needsReload = false;
    this._loaderId++;
    this._loader = this._loadData(opts);
    return this._loader;
  }

  setNeedsReload(): void {
    if (this.isLoading) {
      this.abort();
      this._loader = undefined;
    }
    this._needsReload = true;
  }

  abort(): void {
    if (this.isLoaded) {
      return;
    }

    this._isCancelled = true;
    this._abortController?.abort();
  }
}

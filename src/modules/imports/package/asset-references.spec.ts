import { assetNameOf, assetNamesIn, replaceAssetLinks } from './asset-references';

describe('asset references', () => {
  const text = '如图 ![图1](assets/chart%201.png) 与 ![](./assets/sub/b.png)，外链 ![](https://x/y.png)';

  it('should list referenced asset names relative to assets/', () => {
    expect(assetNamesIn(text)).toEqual(['chart 1.png', 'sub/b.png']);
  });

  it('should replace references with file ids and keep unknown ones', () => {
    expect(replaceAssetLinks(text, new Map([['chart 1.png', 'f1']]))).toBe(
      '如图 ![图1](file:f1) 与 ![](./assets/sub/b.png)，外链 ![](https://x/y.png)',
    );
  });

  it('should accept audio names with or without the assets prefix', () => {
    expect(assetNameOf(' assets/a.mp3 ')).toBe('a.mp3');
    expect(assetNameOf('a.mp3')).toBe('a.mp3');
  });
});

import { startCurve, addToCurve } from './main';
import sampleLines from '../test-utils/sample-lines';

sampleLines.forEach((line) => {
    test('fits curves deterministically', () => {
        const [first, ...rest] = line;

        startCurve(first);
        expect(rest.reduce((memo, point) => addToCurve(point))).toMatchSnapshot();
    });
});

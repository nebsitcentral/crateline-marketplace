// Demo clock. Staff can advance time from the demo toolbar; every rule reads now().
export const CLOCK = { offset: 0 };
export const now = () => Date.now() + CLOCK.offset;
export const HOUR = 36e5, DAY = 864e5;

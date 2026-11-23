// Fake HA services and entities for this area (installed by createFakeHass). Owned by the area's screens.
import type {FakeHass} from '../ha-fixture';

export function installRobotVehicleFake(fake: FakeHass): void {
  // Filled by the screens of this area.
  fake.handle('podvoice.__placeholder', () => undefined);
}

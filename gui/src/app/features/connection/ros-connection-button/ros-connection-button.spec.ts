import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';

import { ConnectionManager } from '../connection-manager/connection-manager';
import { RosConnectionButton } from './ros-connection-button';

describe('RosConnectionButton', () => {
  let fixture: ComponentFixture<RosConnectionButton>;
  let openDialog: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    openDialog = vi.fn();
    await TestBed.configureTestingModule({
      imports: [RosConnectionButton],
      providers: [{ provide: MatDialog, useValue: { open: openDialog } }],
    }).compileComponents();
  });

  it.each([
    ['rover', 'Rover Link'],
    ['basestation', 'BaseStation Link'],
  ] as const)('opens settings for the %s target', (target, label) => {
    fixture = TestBed.createComponent(RosConnectionButton);
    fixture.componentRef.setInput('target', target);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(label);
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();

    expect(openDialog).toHaveBeenCalledWith(
      ConnectionManager,
      expect.objectContaining({ data: { target } }),
    );
  });
});

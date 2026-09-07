import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ControlScheme } from './control-scheme';

describe('ControlScheme', () => {
  let component: ControlScheme;
  let fixture: ComponentFixture<ControlScheme>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ControlScheme],
    }).compileComponents();

    fixture = TestBed.createComponent(ControlScheme);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should provide left, center, and right scheme regions', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.mapping-left')).toBeTruthy();
    expect(element.querySelector('.scheme-gamepad')).toBeTruthy();
    expect(element.querySelector('.mapping-right')).toBeTruthy();
  });

  it('should render the active pilot catalogue mapping', () => {
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Left track');
    expect(text).toContain('Gimbal Priority');
  });

  it('should render the active arm catalogue mapping', () => {
    fixture.componentRef.setInput('context', 'arm');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('IK horizontal position');
    expect(text).toContain('Open end-effector');
  });
});

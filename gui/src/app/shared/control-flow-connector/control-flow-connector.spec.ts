import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ControlFlowConnector } from './control-flow-connector';

describe('ControlFlowConnector', () => {
  let fixture: ComponentFixture<ControlFlowConnector>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ControlFlowConnector] }).compileComponents();
    fixture = TestBed.createComponent(ControlFlowConnector);
    fixture.componentRef.setInput('variant', 'vertical');
    fixture.detectChanges();
  });

  it('should render the requested connector variant', () => {
    expect(fixture.nativeElement.querySelector('svg.vertical')).toBeTruthy();
  });
});

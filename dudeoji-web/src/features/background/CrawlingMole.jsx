import "./CrawlingMole.css";

function CrawlingMole() {
  return (
    <div className="dudeoji-crawling-mole-layer" aria-hidden="true">
      <div className="dudeoji-crawling-mole-track">
        <div className="dudeoji-crawling-mole">
          <span className="mole-shadow" />
          <span className="mole-body">
            <span className="mole-ear mole-ear-left" />
            <span className="mole-ear mole-ear-right" />
            <span className="mole-head">
              <span className="mole-eye" />
              <span className="mole-nose" />
            </span>
            <span className="mole-paw mole-paw-front" />
            <span className="mole-paw mole-paw-back" />
          </span>
          <span className="mole-dirt mole-dirt-one" />
          <span className="mole-dirt mole-dirt-two" />
          <span className="mole-dirt mole-dirt-three" />
        </div>
      </div>
    </div>
  );
}

export default CrawlingMole;

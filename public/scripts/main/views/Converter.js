import converterTemplate from './../../../../templates/converter.hbs';
import parseHTML from './../../utils/parseHTML';

export default function Converter(container) {
    this._container = container;
    this._converterPanelHolder = container.querySelector('.cv-holder');
}

// Any there any currencies in the view?
Converter.prototype.showingCurrencies = function() {
    return !!this._container.querySelector('.cc_lb');//check if any dropdown is present in the page
};

/**
 * Add the currencies to the view
 * 
 * @param array currencies The currencies available
 */
Converter.prototype.addCurrencies = function(currencies) {
    // console.log('About adding currencies to view', currencies);

    const htmlString = converterTemplate({currencies});
    // console.log(htmlString);

    // add the converter to the dom
    var node = parseHTML(htmlString);
    this._converterPanelHolder.insertBefore(node, this._converterPanelHolder.firstChild);

    // remove the loader
    const loader = this._container.querySelector('.loader');
    if(loader.parentNode) {
        loader.parentNode.removeChild(loader);
    }
}